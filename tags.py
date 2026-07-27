"""
Step 1 of the two-step reply pipeline: read the email before writing to it.

    incoming email -> tags.analyse()  -> intent / sentiment / urgency / entities
                   -> prompts + llm   -> the reply the customer receives

The analyser prompt lives in email_automatic_reply_en_US.jinja2 rather than in
Python so the taxonomy can be edited without touching code. That file holds both
halves of the conversation separated by a `# User Prompt` heading: everything
above it is the system prompt, everything below is the user turn rendered with
the buyer message and the optional product/order context.

Two contracts the rest of the app leans on:

* `analyse()` never raises. Tagging is an enhancement; a classifier outage must
  not cost the customer their reply. On failure it returns a dict carrying only
  `error` and `analysis_ms` — no invented intent, no fabricated confidence.
* Values are validated against the taxonomy in the template before they reach
  the database. A model that makes up an intent gets coerced to `other`, and a
  confidence outside 0-1 is dropped rather than stored.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined

import llm

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_PATH = BASE_DIR / "email_automatic_reply_en_US.jinja2"

# The heading that separates the system half of the template from the user half.
_USER_PROMPT_MARKER = re.compile(r"^#[ \t]+User Prompt[ \t]*$", re.MULTILINE)

# Taxonomy, mirrored from the template. Kept here as the validation whitelist, so
# adding a category is a two-line change: the table in the template, and this.
INTENTS = (
    "order_issue", "shipping_issue", "return_refund", "product_quality",
    "product_inquiry", "wrong_missing_item", "payment_issue", "seller_complaint",
    "review_feedback", "account_security", "warranty_replacement", "other",
)
SENTIMENTS = ("satisfied", "neutral", "confused", "disappointed", "frustrated", "angry")
URGENCIES = ("low", "medium", "high", "critical")
LANGUAGES = ("en", "es", "other")
ENTITY_FIELDS = ("product_mentioned", "issue_mentioned", "deadline_mentioned")

# The tag record itself, in the order the UI reads it. `analysis_ms` and `error`
# are bookkeeping and deliberately not part of this.
TAG_FIELDS = (
    "intent", "intent_confidence", "sentiment", "sentiment_confidence",
    "urgency", "language", "key_entities", "summary",
)

_env = Environment(
    undefined=StrictUndefined,  # a renamed template variable should fail loudly
    trim_blocks=True,
    lstrip_blocks=True,
    autoescape=False,           # this renders a prompt, not HTML
)


def _split_template() -> tuple[str, str]:
    raw = TEMPLATE_PATH.read_text(encoding="utf-8")
    halves = _USER_PROMPT_MARKER.split(raw, maxsplit=1)
    if len(halves) != 2:
        raise RuntimeError(
            f"{TEMPLATE_PATH.name} must contain a '# User Prompt' heading separating "
            "the system prompt from the user turn."
        )
    return halves[0].strip(), halves[1].strip()


SYSTEM_PROMPT, _USER_TEMPLATE_SRC = _split_template()
_USER_TEMPLATE = _env.from_string(_USER_TEMPLATE_SRC)


def _as_context(block: dict[str, Any] | None) -> str:
    """JSON for the template, or '' so its `{% if %}` drops the section entirely."""
    return json.dumps(block, ensure_ascii=False, indent=2) if block else ""


def build_user_message(*, subject: str, body: str, context: dict[str, Any] | None) -> str:
    ctx = context or {}
    buyer_message = f"Subject: {subject}\n\n{body}" if subject.strip() else body
    return _USER_TEMPLATE.render(
        buyer_message=buyer_message.strip(),
        product_context=_as_context(ctx.get("product")),
        order_context=_as_context(ctx.get("order")),
    )


def _one_of(value: Any, allowed: tuple[str, ...], fallback: str) -> str:
    v = str(value or "").strip().lower()
    return v if v in allowed else fallback


def _confidence(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return round(min(max(f, 0.0), 1.0), 3)


def _text(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in {"null", "none", "n/a"}:
        return None
    return s[:limit]


def parse_tags(text: str) -> dict[str, Any] | None:
    """Validate the analyser's JSON against the taxonomy. None if unusable."""
    obj = llm.parse_json(text)
    if not obj:
        return None

    entities = obj.get("key_entities")
    if not isinstance(entities, dict):
        entities = {}

    return {
        "intent": _one_of(obj.get("intent"), INTENTS, "other"),
        "intent_confidence": _confidence(obj.get("intent_confidence")),
        "sentiment": _one_of(obj.get("sentiment"), SENTIMENTS, "neutral"),
        "sentiment_confidence": _confidence(obj.get("sentiment_confidence")),
        "urgency": _one_of(obj.get("urgency"), URGENCIES, "low"),
        "language": _one_of(obj.get("language"), LANGUAGES, "other"),
        "key_entities": {f: _text(entities.get(f), 200) for f in ENTITY_FIELDS},
        "summary": _text(obj.get("summary"), 400),
    }


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


async def analyse(*, subject: str, body: str, context: dict[str, Any] | None) -> dict[str, Any]:
    """Classify one incoming email. Never raises — see the module docstring."""
    started = time.perf_counter()
    try:
        raw = await llm.complete(
            SYSTEM_PROMPT, build_user_message(subject=subject, body=body, context=context)
        )
        tags = parse_tags(llm.extract_text(raw))
    except llm.LLMError as exc:
        return {"error": str(exc)[:400], "analysis_ms": _elapsed_ms(started)}
    except Exception as exc:  # noqa: BLE001 - the never-raise contract is the point
        return {"error": f"{type(exc).__name__}: {exc}"[:400], "analysis_ms": _elapsed_ms(started)}

    if tags is None:
        return {
            "error": "The analyser did not return a usable JSON object.",
            "analysis_ms": _elapsed_ms(started),
        }
    tags["analysis_ms"] = _elapsed_ms(started)
    return tags


def is_usable(tags: dict[str, Any] | None) -> bool:
    return bool(tags and tags.get("intent"))


def to_prompt_block(tags: dict[str, Any] | None) -> str:
    """The MESSAGE ANALYSIS section for the reply prompt.

    Empty when step 1 produced nothing usable, so the writer is never handed a
    placeholder intent that it might then act on.
    """
    if not is_usable(tags):
        return ""
    return json.dumps({f: tags.get(f) for f in TAG_FIELDS}, ensure_ascii=False, indent=2)
