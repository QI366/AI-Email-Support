"""
Thin OpenAI-compatible chat client.

Kept deliberately dependency-light (httpx only) so it works against the official
API or any compatible gateway. Newer model families reject some legacy
parameters, so unsupported ones are stripped and the call is retried once.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx


class LLMError(RuntimeError):
    pass


def _env(*names: str, default: str | None = None) -> str | None:
    for n in names:
        v = os.getenv(n)
        if v:
            return v.strip()
    return default


API_KEY_NAMES = ("MODEL_OPENAI_API_KEY", "OPENAI_API_KEY")
BASE_URL_NAMES = ("MODEL_OPENAI_BASE_URL", "OPENAI_BASE_URL")


def config() -> dict[str, Any]:
    return {
        "model": _env("MODEL_NAME", "OPENAI_MODEL", default="gpt-5.4-mini"),
        "base_url": (_env(*BASE_URL_NAMES, default="https://api.openai.com/v1") or "").rstrip("/"),
        "has_key": bool(_env(*API_KEY_NAMES)),
        "timeout": float(_env("MODEL_TIMEOUT", default="90") or 90),
    }


_UNSUPPORTED = re.compile(
    r"unsupported[_ ]parameter|unsupported value|unrecognized request argument|"
    r"is not supported with this model|invalid_request_error",
    re.IGNORECASE,
)


async def complete(system: str, user: str) -> dict[str, Any]:
    cfg = config()
    api_key = _env(*API_KEY_NAMES)
    if not api_key:
        raise LLMError(
            "No API key found. Set MODEL_OPENAI_API_KEY in the .env file next to server.py."
        )

    payload: dict[str, Any] = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
        "max_completion_tokens": int(_env("MODEL_MAX_TOKENS", default="1600") or 1600),
    }
    temp = _env("MODEL_TEMPERATURE")
    if temp:
        payload["temperature"] = float(temp)

    url = f"{cfg['base_url']}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=cfg["timeout"]) as client:
        for attempt in range(3):
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code < 400:
                return resp.json()

            detail = resp.text[:600]
            # Strip whatever the endpoint dislikes and retry once per offender.
            if resp.status_code == 400 and _UNSUPPORTED.search(detail) and attempt < 2:
                dropped = False
                for key in ("response_format", "max_completion_tokens", "temperature"):
                    if key in payload and key.replace("_", "") in detail.replace("_", "").lower():
                        payload.pop(key)
                        dropped = True
                if not dropped and "max_completion_tokens" in payload:
                    payload["max_tokens"] = payload.pop("max_completion_tokens")
                    dropped = True
                if dropped:
                    continue
            raise LLMError(f"Model API returned {resp.status_code}: {detail}")

    raise LLMError("Model API call failed after retries.")


def extract_text(data: dict[str, Any]) -> str:
    try:
        return (data["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError) as exc:  # pragma: no cover - defensive
        raise LLMError(f"Unexpected response shape: {json.dumps(data)[:400]}") from exc


def parse_json(text: str) -> dict[str, Any] | None:
    """Best-effort JSON object from a model response, tolerating fences or prose.

    Shared by both pipeline steps: the tag analyser and the reply writer.
    """
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    candidates = [cleaned]
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        candidates.append(match.group(0))

    for candidate in candidates:
        try:
            obj = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            return obj
    return None


def parse_reply(text: str) -> dict[str, str]:
    """Parse the model's JSON reply, tolerating fences or surrounding prose."""
    obj = parse_json(text)
    if obj and obj.get("body"):
        return {
            "language": (obj.get("language") or "en").lower()[:2],
            "subject": (obj.get("subject") or "").strip(),
            "body": str(obj["body"]).strip(),
        }

    # Model ignored the format: keep the prose rather than failing the request.
    return {"language": "", "subject": "", "body": text.strip()}
