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

import emotion_recognition as emotion  # noqa: E402
import llm  # noqa: E402
import policy  # noqa: E402
import prompts  # noqa: E402
import scenarios  # noqa: E402
import store  # noqa: E402
import tags  # noqa: E402
import token_cost  # noqa: E402

# Step 2（写回复）可以单独配置一个模型，跟 Step 1 打标签的模型不必是同一个；
# 不设置时回退到 llm.config() 里的默认模型。token_cost 用同名的 "reply" step
# 去查对应的单价环境变量（MODEL_PRICE_*_PER_1M_REPLY）。
MODEL_NAME_REPLY = os.getenv("MODEL_NAME_REPLY") or None

MAX_SUBJECT = 160
MAX_BODY = 4000
# 情绪测试台的单次输入上限。比邮件正文短：这里是拿一段话试模型，不是发一封信，
# 而且服务端按句子切分后再池化，几千字的输入只会把一次"试一下"拖成好几秒。
MAX_EMOTION_TEXT = 2000

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


class ManualReplyRequest(BaseModel):
    subject: str = Field(default="", max_length=MAX_SUBJECT)
    body: str = Field(min_length=1, max_length=MAX_BODY)


class EmotionTestRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_EMOTION_TEXT)
    sample_id: str | None = Field(default=None, max_length=60)


class EmotionFeedbackRequest(BaseModel):
    verdict: str | None = Field(default=None)          # 'correct' | 'wrong' | None(撤回评价)
    true_labels: list[str] = Field(default_factory=list)
    note: str = Field(default="", max_length=400)


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
    # print(f"上下文信息context: {context}")
    if context is None:
        raise HTTPException(status_code=400, detail="Pick one of the listed order scenarios.")

    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Write a message before sending.")

    subject = payload.subject.strip()
    who = identity(request)
    facts = policy.evaluate(context, today)
    # 正则匹配判断邮件语言
    language = prompts.detect_language(f"{subject}\n{body}")
    # print(f"识别到的邮件语言: {language}")

    # Step 1: classify the incoming email. Never raises, so the thread below is
    # still recorded even when the analyser is down.
    # 调用模型给邮件打标签
    # print(f"邮件内容主题: {subject}，邮件内容: {body}")
    # policy_facts 一起传进去，人工复核规则引擎要用这些确定性事实（SLA 是否违约、
    # 是否超出退货/保修窗口）来判断，而不是只看模型自己的判断
    email_tags = await tags.analyse(subject=subject, body=body, context=context, policy_facts=facts)
    # print(f"抽取出来的邮件标签: {email_tags}")

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

    # 这封邮件的总成本 = Step 1（打标签，已经在 tags.analyse() 里算过）+ Step 2（写回复）。
    # 两步分别累加，summary() 里既能看到各自的明细，也能看到总和。
    cost_tracker = token_cost.CostTracker()
    if isinstance(email_tags.get("token_usage"), dict):
        cost_tracker.add_usage(email_tags["token_usage"], step="tags")

    started = time.perf_counter()
    try:
        raw = await llm.complete(prompts.SYSTEM_PROMPT, user_message, model=MODEL_NAME_REPLY)
        reply = llm.parse_reply(llm.extract_text(raw))
    except llm.LLMError as exc:
        store.finish_thread(thread_id, status="failed", error=str(exc),
                            latency_ms=int((time.perf_counter() - started) * 1000))
        print(f"thread={thread_id} Step 2 失败，仅 Step 1 产生成本: {cost_tracker.summary()}")
        return JSONResponse(
            status_code=502,
            content={"thread_id": thread_id, "status": "failed", "detail": str(exc)},
        )

    cost_tracker.add_response(raw, step="reply")

    latency_ms = int((time.perf_counter() - started) * 1000)
    reply_language = reply["language"] if reply["language"] in {"en", "es"} else language
    reply_subject = reply["subject"] or prompts.fallback_subject(subject, reply_language)

    store.finish_thread(
        thread_id,
        status="replied",
        reply_subject=reply_subject,
        reply_body=reply["body"],
        reply_language=reply_language,
        model=MODEL_NAME_REPLY or llm.config()["model"],
        latency_ms=latency_ms,
    )
    print(f"thread={thread_id} token 用量/成本明细(按 step): {cost_tracker.summary()}")
    print(f"content={store.get_thread(thread_id)}")
    return JSONResponse(status_code=200, content=store.get_thread(thread_id) or {})


@app.post("/api/threads/{thread_id}/manual-reply")
async def manual_reply(thread_id: int, payload: ManualReplyRequest) -> dict[str, Any]:
    """Human-in-the-loop escape hatch: a support agent writes the reply
    themselves, overriding whatever Step 2 produced — used when the analyser
    flagged needs_review, or any time the AI draft just isn't good enough.
    """
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Write a reply before sending.")

    language = prompts.detect_language(f"{payload.subject}\n{body}")
    subject = payload.subject.strip() or prompts.fallback_subject(thread["subject"] or "", language)

    store.set_manual_reply(thread_id, reply_subject=subject, reply_body=body, reply_language=language)
    return store.get_thread(thread_id) or {}


# --------------------------------------------------------------------------
# 情绪模型测试台：拿一段文本直接试本地情绪模型，人给对错反馈，记录所有人可见
# --------------------------------------------------------------------------
@app.get("/api/emotion/meta")
async def emotion_meta() -> dict[str, Any]:
    """模型档案 + 能识别的全部标签 + 示例语料 + 端点是否配置好。页面的说明书部分。

    不返回 EMOTION_API_URL：那是内网地址，页面只需要知道"配没配"（enabled），
    知道具体指到哪台机器对使用者没有帮助。
    """
    cfg = emotion.config()
    return {
        "enabled": cfg["enabled"],
        "timeout": cfg["timeout"],
        "model": emotion.model_card(),
        "aggregator": emotion.aggregator(),
        "response_fields": list(emotion.RESPONSE_FIELDS),
        "taxonomy": emotion.taxonomy(),
        "samples": [dict(s) for s in emotion.SAMPLES],
        "max_chars": MAX_EMOTION_TEXT,
    }


@app.post("/api/emotion/test")
async def emotion_test(payload: EmotionTestRequest, request: Request) -> dict[str, Any]:
    """跑一次情绪识别并落库。

    识别失败**也要落库**（error 列写原因）——"模型对这句话给不出结果"本身就是测试
    结果，把它丢掉等于让测试台只展示模型顺利的那一面。所以这里不抛 5xx。
    """
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Type something to analyse.")

    who = identity(request)
    sample_id = payload.sample_id if payload.sample_id in emotion.SAMPLE_IDS else None

    result: dict[str, Any] | None = None
    error: str | None = None
    try:
        result = await emotion.classify(text)
    except emotion.EmotionError as exc:
        error = str(exc)[:400]
    except Exception as exc:  # noqa: BLE001 - 测试台不该被一个意外异常打死
        error = f"{type(exc).__name__}: {exc}"[:400]

    test_id = store.create_emotion_test(
        user_id=who["user_id"],
        ip=who["ip"],
        text=text,
        sample_id=sample_id,
        result_json=json.dumps(result, ensure_ascii=False) if result else None,
        sentiment=result["sentiment"] if result else None,
        score=result["score"] if result else None,
        l1=(result or {}).get("l1"),
        latency_ms=(result or {}).get("latency_ms"),
        error=error,
        created_at=time.time(),
    )
    return store.get_emotion_test(test_id) or {}


@app.post("/api/emotion/tests/{test_id}/feedback")
async def emotion_feedback(test_id: int, payload: EmotionFeedbackRequest, request: Request) -> dict[str, Any]:
    verdict = payload.verdict if payload.verdict in ("correct", "wrong") else None
    # 真实标签过白名单：前端传来的簇名必须是模型真的有的那 9 个，去重且保序
    labels = list(dict.fromkeys(l for l in payload.true_labels if l in emotion.SENTIMENTS))
    if verdict == "wrong" and not labels:
        raise HTTPException(status_code=400, detail="Pick the label you think is right.")

    who = identity(request)
    if not store.set_emotion_feedback(
        test_id, verdict=verdict, true_labels=labels, note=payload.note.strip(), user_id=who["user_id"]
    ):
        raise HTTPException(status_code=404, detail="Test not found")
    return store.get_emotion_test(test_id) or {}


@app.get("/api/emotion/tests")
async def emotion_tests(request: Request, scope: str = "all", limit: int = 100, offset: int = 0) -> dict[str, Any]:
    who = identity(request)
    limit = max(1, min(limit, 300))
    user_filter = who["user_id"] if scope == "mine" else None
    return {
        "scope": scope,
        "user_id": who["user_id"],
        "tests": store.list_emotion_tests(user_filter, limit=limit, offset=offset),
    }


@app.get("/api/emotion/tests/{test_id}")
async def emotion_test_detail(test_id: int) -> dict[str, Any]:
    """单条测试。给 ?test=<id> 这种分享链接用——测试台是块公开板子，
    "你看模型把我这句话读成什么了"得能指到具体哪一条。"""
    test = store.get_emotion_test(test_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Test not found")
    return test


@app.get("/api/emotion/stats")
async def emotion_stats(request: Request, scope: str = "all") -> dict[str, Any]:
    who = identity(request)
    user_filter = who["user_id"] if scope == "mine" else None
    return {"scope": scope, "vocabulary": list(emotion.SENTIMENTS), **store.emotion_test_stats(user_filter)}


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
