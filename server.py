"""
Helios Support Mailbox - AI email reply demo.

Run:  python server.py         ->  http://0.0.0.0:1222
"""

from __future__ import annotations

import json
import os
import time
from datetime import date
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent


# --------------------------------------------------------------------------
# .env loading (no external dependency)
# --------------------------------------------------------------------------
def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env(BASE_DIR / ".env")

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import llm  # noqa: E402
import policy  # noqa: E402
import prompts  # noqa: E402
import scenarios  # noqa: E402
import store  # noqa: E402
import tags  # noqa: E402

MAX_SUBJECT = 160
MAX_BODY = 4000

app = FastAPI(title="Helios Support Mailbox", version="1.0.0")
store.init()


# --------------------------------------------------------------------------
# Identity: one IP == one user
# --------------------------------------------------------------------------
def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    return request.client.host if request.client else "unknown"


def identity(request: Request) -> dict[str, str]:
    ip = client_ip(request)
    return {"ip": ip, "user_id": store.user_id_for_ip(ip)}


class SendRequest(BaseModel):
    scenario_id: str
    subject: str = Field(default="", max_length=MAX_SUBJECT)
    body: str = Field(min_length=1, max_length=MAX_BODY)


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@app.get("/api/me")
async def me(request: Request) -> dict[str, Any]:
    who = identity(request)
    return {**who, "stats": store.stats()}


@app.get("/api/scenarios")
async def get_scenarios() -> dict[str, Any]:
    today = date.today()
    items = []
    for sc in scenarios.list_scenarios(today):
        items.append({**sc, "policy": policy.evaluate(sc, today)})
    return {"scenarios": items}


@app.get("/api/policy")
async def get_policy() -> dict[str, Any]:
    """The rulebook constants behind policy.evaluate(), for the policy console."""
    return {
        "today": date.today().isoformat(),
        "constants": {
            "return_window_days": policy.RETURN_WINDOW_DAYS,
            "damage_report_window_days": policy.DAMAGE_REPORT_WINDOW_DAYS,
            "warranty_months": policy.WARRANTY_MONTHS,
            "restocking_fee_pct": policy.RESTOCKING_FEE_PCT,
            "refund_sla_days": policy.REFUND_SLA_DAYS,
            "lost_package_claim_days": policy.LOST_PACKAGE_CLAIM_DAYS,
            "cancel_window_hours": policy.CANCEL_WINDOW_HOURS,
        },
    }


@app.get("/api/tags/stats")
async def get_tag_stats(request: Request, scope: str = "all") -> dict[str, Any]:
    """Tag distributions across every mailbox (or just the caller's)."""
    who = identity(request)
    user_filter = who["user_id"] if scope == "mine" else None
    return {
        "scope": scope,
        "taxonomy": {
            "intent": list(tags.INTENTS),
            "sentiment": list(tags.SENTIMENTS),
            "urgency": list(tags.URGENCIES),
            "language": list(tags.LANGUAGES),
        },
        **store.tag_stats(user_filter),
    }


@app.get("/api/threads")
async def get_threads(request: Request, scope: str = "all", limit: int = 60, offset: int = 0) -> dict[str, Any]:
    who = identity(request)
    limit = max(1, min(limit, 200))
    user_filter = who["user_id"] if scope == "mine" else None
    return {
        "scope": scope,
        "user_id": who["user_id"],
        "threads": store.list_threads(user_filter, limit=limit, offset=offset),
    }


@app.get("/api/threads/{thread_id}")
async def get_thread(thread_id: int, request: Request) -> dict[str, Any]:
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    thread["is_mine"] = thread["user_id"] == identity(request)["user_id"]
    return thread


@app.post("/api/mail")
async def send_mail(payload: SendRequest, request: Request) -> JSONResponse:
    today = date.today()
    context = scenarios.materialise(payload.scenario_id, today)
    if context is None:
        raise HTTPException(status_code=400, detail="Pick one of the listed order scenarios.")

    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Write a message before sending.")

    subject = payload.subject.strip()
    who = identity(request)
    facts = policy.evaluate(context, today)
    language = prompts.detect_language(f"{subject}\n{body}")

    # Step 1: classify the incoming email. Never raises, so the thread below is
    # still recorded even when the analyser is down.
    email_tags = await tags.analyse(subject=subject, body=body, context=context)

    thread_id = store.create_thread(
        user_id=who["user_id"],
        ip=who["ip"],
        scenario_id=context["scenario_id"],
        scenario_title=context["title"],
        context_json=json.dumps(context, ensure_ascii=False),
        policy_json=json.dumps(facts, ensure_ascii=False),
        tags_json=json.dumps(email_tags, ensure_ascii=False),
        in_subject=subject,
        in_body=body,
        in_language=language,
        status="sending",
        created_at=time.time(),
    )

    # Step 2: write the reply, with the tags injected alongside the email.
    user_message = prompts.build_user_message(
        subject=subject, body=body, context=context, policy_facts=facts, language=language,
        tag_block=tags.to_prompt_block(email_tags),
    )

    started = time.perf_counter()
    try:
        raw = await llm.complete(prompts.SYSTEM_PROMPT, user_message)
        reply = llm.parse_reply(llm.extract_text(raw))
    except llm.LLMError as exc:
        store.finish_thread(thread_id, status="failed", error=str(exc),
                            latency_ms=int((time.perf_counter() - started) * 1000))
        return JSONResponse(
            status_code=502,
            content={"thread_id": thread_id, "status": "failed", "detail": str(exc)},
        )

    latency_ms = int((time.perf_counter() - started) * 1000)
    reply_language = reply["language"] if reply["language"] in {"en", "es"} else language
    reply_subject = reply["subject"] or prompts.fallback_subject(subject, reply_language)

    store.finish_thread(
        thread_id,
        status="replied",
        reply_subject=reply_subject,
        reply_body=reply["body"],
        reply_language=reply_language,
        model=llm.config()["model"],
        latency_ms=latency_ms,
    )
    return JSONResponse(status_code=200, content=store.get_thread(thread_id) or {})


@app.get("/api/health")
async def health() -> dict[str, Any]:
    cfg = llm.config()
    return {
        "ok": True,
        "model": cfg["model"],
        "base_url": cfg["base_url"],
        "api_key_loaded": cfg["has_key"],
        **store.stats(),
    }


# --------------------------------------------------------------------------
# Static site
# --------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "1222"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
