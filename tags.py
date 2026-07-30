"""
Step 1 of the two-step reply pipeline: read the email before writing to it.

    incoming email -> tags.analyse()  -> intent / sentiment / urgency / entities
                   -> prompts + llm   -> the reply the customer receives

-----
分类机制（不是黑箱）
-----
本模块没有使用单独的 ML 分类器模型。大模型本身就是分类器：

  1. 加载模板文件 email_automatic_reply_en_US.jinja2，按 "# User Prompt" 分割为
     system prompt 和 user prompt 两部分。
  2. System prompt 定义了一张分类表：12 种意图、6 种情绪、4 级紧急度，每种都带有
     描述和示例。
  3. User prompt 注入买家实际的邮件内容（+ 可选的商品/订单上下文），要求大模型
     输出 JSON。
  4. 调用 llm.complete()，传入 response_format={"type": "json_object"}，强制大模型
     返回结构化 JSON（而非自由文本）。
  5. parse_tags() 对 LLM 返回的每个字段做白名单校验——如果大模型"幻觉"出一个不存在
     的标签，会被强制纠正为安全兜底值。

分类模板存放在 email_automatic_reply_en_US.jinja2 而非 Python 代码中，这样修改
分类体系时不需要改动代码。

⚠️ 关于置信度的重要说明：
  "intent_confidence" 和 "sentiment_confidence" 是大模型对自己判断的"自我评估"，
  而不是统计模型输出的概率值。模板里要求模型在邮件模糊时输出 < 0.7 的置信度，
  但模型是否真的遵守这条规则，取决于模型本身的能力。代码层面没有对置信度的语义
  准确性做任何校准或验证。

  -> 低置信度 = 模型"自认为"不确定（但这个自我评估也可能不准确）
  -> 高置信度 ≠ 标签一定正确

两个核心约定：

* `analyse()` 永远不抛异常。标签分析是锦上添花，分类器挂了不能导致用户收不到
  回复。出错时返回只含 `error` 和 `analysis_ms` 的 dict，不编造任何标签。
* 入库前所有值都经白名单校验。如果大模型编造了一个不存在的意图，会被纠正为
  "other"；置信度不在 0-1 范围内则直接丢弃，不存入数据库。
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined

import llm
import token_cost

# Step 1 可以单独配置一个模型（比如用更便宜的模型做分类），不设置时回退到
# llm.config() 里的默认模型。token_cost 那边用同名的 "tags" step 去查对应的
# 单价环境变量（MODEL_PRICE_*_PER_1M_TAGS）。
MODEL_NAME_TAGS = os.getenv("MODEL_NAME_TAGS") or None

BASE_DIR = Path(__file__).resolve().parent
PROMPT_DIR = BASE_DIR / "prompt"
TEMPLATE_PATH = PROMPT_DIR / "email_automatic_reply_en_US.jinja2"
TEMPLATE_PATH_01 = PROMPT_DIR / "email_automatic_reply_en_US_01.jinja2"

# The heading that separates the system half of the template from the user half.
_USER_PROMPT_MARKER = re.compile(r"^#[ \t]+User Prompt[ \t]*$", re.MULTILINE)

# 分类白名单，与模板中的表格保持同步。
# 新增一个类别需要改两个地方：模板里的表格 + 这里的元组。
INTENTS = (
    "order_issue", "shipping_issue", "return_refund", "product_quality",
    "product_inquiry", "wrong_missing_item", "payment_issue", "seller_complaint",
    "review_feedback", "account_security", "warranty_replacement", "other",
)
SENTIMENTS = ("satisfied", "neutral", "confused", "disappointed", "frustrated", "angry")
URGENCIES = ("low", "medium", "high", "critical")
LANGUAGES = ("en", "es", "other")
ENTITY_FIELDS = ("product_mentioned", "issue_mentioned", "deadline_mentioned")
# 歧义程度clear | moderate | high | critical
AMBIGUITY_LEVELS = ("clear", "moderate", "high", "critical")

# The tag record itself, in the order the UI reads it. `analysis_ms` and `error`
# are bookkeeping and deliberately not part of this.
TAG_FIELDS = (
    "intent", "intent_confidence", "sentiment", "sentiment_confidence",
    "urgency", "language", "key_entities", "summary",
)

# ---------------------------------------------------------------------------
# 人工复核规则引擎：确定性规则，不依赖模型自评
# ---------------------------------------------------------------------------
# 模型在 JSON 里给的 needs_review 只是"模型自己觉得要不要复核"——跟 intent_confidence
# 一样，没有经过任何校准，模型说不需要复核不代表真的安全。下面这些规则完全由代码
# 判断，命中即强制转人工，与模型自评的结果各自独立保留，最终取"或"。

# B类：高风险意图——涉及账户安全/支付/投诉，出错代价高，需要人工核实
_SENSITIVE_INTENTS = ("account_security", "payment_issue", "seller_complaint")
# B类：情绪与紧急度同时处于高位，说明客诉已经在升级
_NEGATIVE_SENTIMENTS = ("angry", "frustrated")
_HIGH_URGENCIES = ("high", "critical")

# C类：关键词命中即视为高风险信号，按类别分组方便定位命中原因
_LEGAL_KEYWORDS = (
    "lawyer", "attorney", "sue", "lawsuit", "bbb", "ftc",
    "chargeback", "dispute with my bank", "consumer protection",
)
_SAFETY_KEYWORDS = (
    "injured", "injury", "burned", "burn", "fire", "smoke",
    "allergic reaction", "choking", "electric shock",
)
_FRAUD_KEYWORDS = (
    "unauthorized charge", "didn't order this", "did not order this",
    "hacked", "someone else placed", "not my order",
)
_HUMAN_REQUEST_KEYWORDS = (
    "speak to a human", "real person", "speak to a manager", "human agent", "escalate",
)
_REPUTATION_KEYWORDS = (
    "social media", "leave a bad review", "report to amazon", "post publicly",
)
_PRIVACY_KEYWORDS = ("delete my data", "gdpr", "ccpa", "my personal data")

# D类：订单/商品金额超过这个阈值（美元）时，出错代价变高，走人工更稳妥
_HIGH_VALUE_THRESHOLD = 300.0

_env = Environment(
    undefined=StrictUndefined,  # a renamed template variable should fail loudly
    trim_blocks=True,
    lstrip_blocks=True,
    autoescape=False,           # this renders a prompt, not HTML
)


def _split_template() -> tuple[str, str]:
    # 读取整个jinja2 文件
    # raw = TEMPLATE_PATH.read_text(encoding="utf-8")
    raw = TEMPLATE_PATH_01.read_text(encoding="utf-8")
    halves = _USER_PROMPT_MARKER.split(raw, maxsplit=1)# 按 "# User Prompt" 切成两半
    if len(halves) != 2:
        raise RuntimeError(
            f"{TEMPLATE_PATH.name} must contain a '# User Prompt' heading separating "
            "the system prompt from the user turn."
        )
    return halves[0].strip(), halves[1].strip() # 上半 = system, 下半 = user 模板


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
    """将 LLM 返回的置信度数值合法化：截断到 [0, 1]，NaN/Inf/非数字则丢弃。
    注意：这里只验证"值本身是否合法"，不验证"值是否准确"——LLM 填的 0.9 未必
    真的代表 90% 的置信度。
    """
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


def _str_list(value: Any, item_limit: int, max_items: int = 8) -> list[str]:
    """把 LLM 返回的字符串数组字段（如 evidence、review_reasons）清洗为字符串列表。
    如果大模型没有按 schema 返回数组（比如返回了一个字符串或 null），直接丢弃为 []，
    不去猜测拆分规则——宁可前端显示"无"，也不要编造诊断信息。
    """
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        s = _text(item, item_limit)
        if s:
            out.append(s)
        if len(out) >= max_items:
            break
    return out


def _alternative_intents(value: Any, max_items: int = 5) -> list[dict[str, Any]]:
    """校验 alternative_intents：每一项的 intent 走和主 intent 一样的白名单，
    confidence 走同样的 [0,1] 截断规则。intent 不在白名单内的整项丢弃（不像主
    intent 那样兜底为 "other"，因为一条编造的备选意图比没有更容易误导复核人员）。
    """
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        intent = _one_of(item.get("intent"), INTENTS, "")
        if not intent:
            continue
        out.append({
            "intent": intent,
            "confidence": _confidence(item.get("confidence")),
            "reason": _text(item.get("reason"), 200),
        })
        if len(out) >= max_items:
            break
    return out


def parse_tags(text: str) -> dict[str, Any] | None:
    """校验大模型返回的分类 JSON，逐字段做白名单验证。
    如果 JSON 本身无法解析（不是合法 JSON、不是 dict），返回 None。
    如果可以解析但某个值不在白名单内，则替换为安全兜底值（如 intent -> "other"）。
    """
    obj = llm.parse_json(text)
    if not obj:
        return None

    entities = obj.get("key_entities")
    if not isinstance(entities, dict):
        entities = {}
        
        
    # 输出的样式
    # {
	# 	"intent": "<intent_category>",
	# 	"intent_confidence": <0.0 - 1.0>,
	# 	"sentiment": "<sentiment_category>",
	# 	"sentiment_confidence": <0.0 - 1.0>,
	# 	"urgency": "<low | medium | high | critical>",
	# 	"language": "<ISO 639-1 code>",
	# 	"key_entities": {
	# 		"product_mentioned": "<product name or null>",
	# 		"issue_mentioned": "<specific issue or null>",
	# 		"deadline_mentioned": "<deadline or null>"
	# 	},
	# 	"summary": "<one sentence summary of what the buyer wants>",
		
	# 	"evidence": [
	# 		"exact quote or phrase from buyer message",
	# 		"another supporting phrase"
	# 	],
	# 	"alternative_intents": [
	# 		{
	# 		"intent": "<intent_category>",
	# 		"confidence": <0.0 - 1.0>,
	# 		"reason": "why this alternative is plausible"
	# 		}
	# 	],
	# 	"ambiguity_level": "<clear | moderate | high | critical>",
	# 	"needs_review": <true | false>,
	# 	"review_reasons": [
	# 		"reason 1",
	# 		"reason 2"
	# 	]
	# }

    # 每个标签字段都经过白名单校验，不在白名单内的值被强制替换为安全兜底值
    return {
        "intent": _one_of(obj.get("intent"), INTENTS, "other"),
        "intent_confidence": _confidence(obj.get("intent_confidence")),
        "sentiment": _one_of(obj.get("sentiment"), SENTIMENTS, "neutral"),
        "sentiment_confidence": _confidence(obj.get("sentiment_confidence")),
        "urgency": _one_of(obj.get("urgency"), URGENCIES, "low"),
        "language": _one_of(obj.get("language"), LANGUAGES, "other"),
        "key_entities": {f: _text(entities.get(f), 200) for f in ENTITY_FIELDS},
        "summary": _text(obj.get("summary"), 400),
        # 增加一些规则邮件标签识别的诊断字段
        "evidence": _str_list(obj.get("evidence"), 200),
        "alternative_intents": _alternative_intents(obj.get("alternative_intents")),
        "ambiguity_level": _one_of(obj.get("ambiguity_level"), AMBIGUITY_LEVELS, "clear"),
        "needs_review": bool(obj.get("needs_review")) if isinstance(obj.get("needs_review"), bool) else False,
        "review_reasons": _str_list(obj.get("review_reasons"), 200),
    }


def _keyword_hits(text: str, keywords: tuple[str, ...]) -> list[str]:
    """在文本里做大小写不敏感的关键词匹配，返回命中的关键词（可能不止一个）。"""
    low = text.lower()
    return [kw for kw in keywords if kw in low]


def _apply_review_rules(
    tags: dict[str, Any],
    *,
    subject: str,
    body: str,
    context: dict[str, Any] | None,
    policy_facts: dict[str, Any] | None,
) -> None:
    """在 parse_tags() 之后再跑一层确定性的人工复核规则，就地改写 tags 字典。

    模型自己在 JSON 里给的 needs_review/review_reasons 只是"模型自评"——跟置信度
    一样没有经过校准，模型说不需要复核不代表真的安全。这里用完全独立于模型的代码
    规则再判一遍，两路判断都保留下来，方便审计到底是"模型自己觉得该复核"还是
    "命中了第几条规则"：

      model_needs_review / model_review_reasons —— 模型的原始判断，原样保留
      rule_needs_review  / rule_review_reasons  —— 本函数命中的规则
      needs_review       / review_reasons       —— 两者取"或"之后的最终结果，
                                                     前端的复核横幅/按钮继续读这两个字段
    """
    reasons: list[str] = []
    text = f"{subject}\n{body}"
    ctx = context or {}
    order = ctx.get("order") or {}
    product = ctx.get("product") or {}
    customer = ctx.get("customer") or {}
    facts = policy_facts or {}

    # B类：高风险意图 —— 涉及账户安全/支付/投诉，出错代价高
    if tags.get("intent") in _SENSITIVE_INTENTS:
        reasons.append(f"高风险意图：{tags['intent']}（涉及账户安全/支付/投诉，需人工核实）")
    # B类：情绪和紧急度同时处于高位 —— 客诉已经在升级
    if tags.get("sentiment") in _NEGATIVE_SENTIMENTS and tags.get("urgency") in _HIGH_URGENCIES:
        reasons.append(f"情绪（{tags['sentiment']}）与紧急度（{tags['urgency']}）同时处于高位")

    # C类：关键词命中 —— 法务/安全/欺诈/主动要求人工/声誉/隐私，命中任意一类就说明原因
    for label, keywords in (
        ("法务/维权", _LEGAL_KEYWORDS),
        ("产品安全事故", _SAFETY_KEYWORDS),
        ("疑似欺诈/账户异常", _FRAUD_KEYWORDS),
        ("主动要求人工客服", _HUMAN_REQUEST_KEYWORDS),
        ("声誉/公开曝光风险", _REPUTATION_KEYWORDS),
        ("隐私/合规请求", _PRIVACY_KEYWORDS),
    ):
        hits = _keyword_hits(text, keywords)
        if hits:
            reasons.append(f"命中{label}关键词：{', '.join(hits)}")

    # D类：订单/商品金额较高，或 Helios Plus 会员遇到负面情绪/高紧急度 —— 高价值客户，出错代价高
    amount = order.get("amount_paid") or product.get("price")
    if isinstance(amount, (int, float)) and amount >= _HIGH_VALUE_THRESHOLD:
        reasons.append(f"订单/商品金额较高：{amount} ≥ 阈值 {_HIGH_VALUE_THRESHOLD}")
    if customer.get("tier") == "helios_plus" and (
        tags.get("sentiment") in _NEGATIVE_SENTIMENTS or tags.get("urgency") in _HIGH_URGENCIES
    ):
        reasons.append("Helios Plus 会员且情绪/紧急度不佳，避免高价值客户流失")

    # E类：政策边界 —— 复用 policy.evaluate() 已经算好的确定性事实，这些恰恰是
    # "超出标准自动化流程、需要人判断"的场景（善意补偿、SLA 违约、超窗申诉）
    if facts.get("refund_sla_breached"):
        reasons.append("退款 SLA 已违约，需升级到 payments team")
    condition = order.get("condition_reported")
    if condition == "opened_no_defect" and facts.get("inside_return_window") is False:
        reasons.append("退货超出 30 天窗口，只能提供一次性善意补偿，需人工审批")
    if condition == "damaged_in_transit" and facts.get("damage_report_window_met") is False:
        reasons.append("破损报告超出 2 天申报窗口")
    if (
        condition == "battery_failure"
        and facts.get("inside_return_window") is False
        and facts.get("warranty_active") is False
    ):
        reasons.append("已超出退货窗口且 12 个月保修期已过")

    # 模型的原始判断先存一份快照，再用规则结果覆盖出最终的 needs_review/review_reasons
    tags["model_needs_review"] = bool(tags.get("needs_review"))
    tags["model_review_reasons"] = list(tags.get("review_reasons") or [])
    tags["rule_needs_review"] = bool(reasons)
    tags["rule_review_reasons"] = reasons

    tags["needs_review"] = tags["model_needs_review"] or tags["rule_needs_review"]
    # 模型理由在前、规则理由在后，去重合并，供前端仍需要"总览"时使用
    tags["review_reasons"] = tags["model_review_reasons"] + [
        r for r in reasons if r not in tags["model_review_reasons"]
    ]


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


async def analyse(
    *,
    subject: str,
    body: str,
    context: dict[str, Any] | None,
    policy_facts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """对一封邮件做分类。入口函数，永不抛异常（详见模块文档字符串）。"""
    started = time.perf_counter()
    try:
        # 步骤 A：调用大模型，让 LLM 读取邮件并返回分类 JSON（可单独指定 Step 1 的模型）
        raw = await llm.complete(
            SYSTEM_PROMPT, build_user_message(subject=subject, body=body, context=context),
            model=MODEL_NAME_TAGS,
        )
        print(f"LLM 邮件原始抽取结果: {raw}")
        # Step 1 自己的 token 用量/成本，按 "tags" 这个 step 定价，供调用方（server.py）
        # 汇总进整封邮件的总成本
        usage = token_cost.usage_and_cost(raw, step="tags")
        print(f"Step 1 (打标签) token 用量/成本: {usage}")
        # 步骤 B：提取 LLM 返回的文本内容，解析 JSON 并做白名单校验
        tags = parse_tags(llm.extract_text(raw))
        print(f"解析后的邮件标签: {tags}")
    except llm.LLMError as exc:
        return {"error": str(exc)[:400], "analysis_ms": _elapsed_ms(started)}
    except Exception as exc:  # noqa: BLE001 - the never-raise contract is the point
        return {"error": f"{type(exc).__name__}: {exc}"[:400], "analysis_ms": _elapsed_ms(started)}

    if tags is None:
        # JSON 解析失败，但调用本身成功了、token 已经消耗掉了——成本照样要算进去
        return {
            "error": "The analyser did not return a usable JSON object.",
            "analysis_ms": _elapsed_ms(started),
            "token_usage": usage,
        }

    # 步骤 C：确定性规则引擎复核——不管模型自己判没判 needs_review，命中规则就强制转人工
    _apply_review_rules(tags, subject=subject, body=body, context=context, policy_facts=policy_facts)

    tags["token_usage"] = usage
    tags["analysis_ms"] = _elapsed_ms(started)
    return tags


def is_usable(tags: dict[str, Any] | None) -> bool:
    return bool(tags and tags.get("intent"))


def to_prompt_block(tags: dict[str, Any] | None) -> str:
    """将分类结果转为 JSON 字符串，注入 Step 2 回复生成的 prompt 中
    （即 server.py 中构建 user_message 时的 MESSAGE ANALYSIS 区块）。
    如果 Step 1 没有产出可用标签（intent 为空），则返回空字符串，
    不给 Step 2 的 prompt 塞入无效的占位信息。
    """
    if not is_usable(tags):
        return ""
    return json.dumps({f: tags.get(f) for f in TAG_FIELDS}, ensure_ascii=False, indent=2)
