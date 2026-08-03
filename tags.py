"""
Step 1 of the two-step reply pipeline: read the email before writing to it.

    incoming email -> translation.to_english()  -> 英文基准文本 + 原文语种
                   -> tags.analyse()  -> intent / sentiment / urgency / entities
                   -> prompts + llm   -> the reply the customer receives

-----
输入是英文基准文本，不是原文
-----
`analyse()` 拿到的 subject / body 是 translation.to_english() 产出的**英文**文本
（原文本来就是英文时它就是原文本身）。这一层里三个环节都只在英文上可靠：

  * 本地情绪模型只覆盖英文，非英文输入返回 AMBIGUOUS + 全 0 分；
  * `_apply_review_rules()` 的关键词表（lawyer / chargeback / injured…）是英文字面量，
    西语来信里的 "abogado" 一条都命中不了；
  * 分类模板本身是英文写的。

代价是 `language` 标签不能再由大模型来判——它读到的是译文，只会回答 "en"。所以
语种由 translation 层的判定（fasttext）确定性写入，大模型那一份存进 `model_language`
留档，和 sentiment / needs_review 的处理方式一致：两路判断都留着，事后能对账。

-----
分类机制（不是黑箱）
-----
意图 / 紧急度 / 实体 / 摘要由大模型充当分类器；情绪（sentiment）由本地情绪模型
服务产出，两者并发调用、互不阻塞。

大模型这一路：

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

本地情绪模型这一路（详见 emotion_recognition.py）：

  emotion.classify() 返回 9 个情绪簇的模型概率，取分最高的簇（并列时取极性更负
  的那个）写进 sentiment，该簇的分数写进 sentiment_confidence。这是真正的模型
  概率，同一封邮件永远得到同一个结果，可以对着阈值做回归测试。

  模板里那 6 种情绪的表格仍然保留，大模型给的情绪判断存进 model_sentiment 留档，
  只有在本地服务不可用时才顶上来当兜底（此时 sentiment_source = "llm_fallback"）。

⚠️ 关于置信度的重要说明：
  "intent_confidence" 是大模型对自己判断的"自我评估"，而不是统计模型输出的概率值。
  模板里要求模型在邮件模糊时输出 < 0.7 的置信度，但模型是否真的遵守这条规则，取决于
  模型本身的能力。代码层面没有对置信度的语义准确性做任何校准或验证。

  -> 低置信度 = 模型"自认为"不确定（但这个自我评估也可能不准确）
  -> 高置信度 ≠ 标签一定正确

  "sentiment_confidence" 不一样：它是本地情绪模型的输出概率，是可复现的统计量
  （只有在走 llm_fallback 兜底时才退化成模型自评，看 sentiment_source 区分）。

两个核心约定：

* `analyse()` 永远不抛异常。标签分析是锦上添花，分类器挂了不能导致用户收不到
  回复。出错时返回只含 `error` 和 `analysis_ms` 的 dict，不编造任何标签。
* 入库前所有值都经白名单校验。如果大模型编造了一个不存在的意图，会被纠正为
  "other"；置信度不在 0-1 范围内则直接丢弃，不存入数据库。
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined

import emotion_recognition as emotion
import llm
import token_cost
import translation

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
# 情绪词表 = 本地情绪模型的 9 个簇（小写），词表本身定义在 emotion_recognition.py，
# 这里只做引用——服务端加一个簇时不用两头改。
SENTIMENTS = emotion.SENTIMENTS
URGENCIES = ("low", "medium", "high", "critical")
# 语种词表 = 翻译服务支持的 9 种 + "other"，同样只定义在 translation.py 一处。
# 这个字段不由大模型填（它读到的是译文），由 translation 层确定性写入。
LANGUAGES = translation.TAG_LANGUAGES
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
# B类：情绪与紧急度同时处于高位，说明客诉已经在升级。负面簇的定义（hostile /
# frustrated / anxious）跟着情绪模型走，不在这里另起一套。
_NEGATIVE_SENTIMENTS = emotion.NEGATIVE_SENTIMENTS
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


def translation_note(source_lang: str | None, *, translated: bool) -> str:
    """告诉分类模型"你读到的是机翻"。原文本来就是英文时返回空串，模板整块不渲染。

    机翻文本读起来常常生硬、习语被直译，模型很容易把这种别扭当成"买家表达不清"，
    从而抬高 ambiguity_level、压低 intent_confidence——这一句话就是防这个的。
    """
    if not translated or not source_lang:
        return ""
    name = translation.language_name(source_lang)
    return (
        f"The buyer wrote in {name} (`{source_lang}`). The message above is an automatic "
        f"English translation of that email, provided so this analyzer can read it.\n"
        f"- Classify the buyer's intent, sentiment and urgency from the translation.\n"
        f"- Do NOT treat translation artefacts (stilted phrasing, literally translated "
        f"idioms) as buyer ambiguity — judge clarity by what the buyer meant.\n"
        f"- Report `language` as the buyer's original language: `{source_lang}`.\n"
        f"- Quote `evidence` from the translated text; it is the only text you have."
    )


def build_user_message(
    *,
    subject: str,
    body: str,
    context: dict[str, Any] | None,
    note: str = "",
) -> str:
    ctx = context or {}
    buyer_message = f"Subject: {subject}\n\n{body}" if subject.strip() else body
    return _USER_TEMPLATE.render(
        buyer_message=buyer_message.strip(),
        product_context=_as_context(ctx.get("product")),
        order_context=_as_context(ctx.get("order")),
        translation_note=note,
    )


def _one_of(value: Any, allowed: tuple[str, ...], fallback: str) -> str:
    v = str(value or "").strip().lower()
    return v if v in allowed else fallback


# 模板里那张情绪表还是 6 档，而入库词表已经换成 9 个簇。大模型的情绪判断只在本地
# 情绪服务不可用时兜底顶上，所以这里把 6 档折进簇词表：disappointment 本来就属于
# FRUSTRATED 簇，angry 对应 HOSTILE，其余同名直落。
_LLM_SENTIMENT_TO_CLUSTER = {
    "satisfied":    "satisfied",
    "neutral":      "neutral",
    "confused":     "confused",
    "disappointed": "frustrated",
    "frustrated":   "frustrated",
    "angry":        "hostile",
}


def _llm_sentiment(value: Any) -> str:
    """大模型给的情绪 -> 簇词表。认不出来的一律落到 neutral，和其他字段的兜底
    策略一致：宁可给一个中性值，也不要凭空造一个不存在的标签。
    """
    v = str(value or "").strip().lower()
    if v in SENTIMENTS:                 # 模型直接吐簇名也照收
        return v
    return _LLM_SENTIMENT_TO_CLUSTER.get(v, "neutral")


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
        # 这两个值随后会被本地情绪模型覆盖（见 _apply_emotion），只有情绪服务
        # 不可用时才作为兜底留在 sentiment 上。
        "sentiment": _llm_sentiment(obj.get("sentiment")),
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


def _apply_emotion(tags: dict[str, Any], result: Any) -> None:
    """用本地情绪模型的结果覆盖 sentiment，就地改写 tags。

    大模型自己那份情绪判断先存一份快照再覆盖——和 needs_review 那边一样，两路
    判断都留着，事后能看出到底是谁判错了：

      model_sentiment / model_sentiment_confidence —— 大模型的自评，原样保留
      sentiment       / sentiment_confidence       —— 本地模型的簇 + 该簇概率
      sentiment_source —— "local_model" 还是 "llm_fallback"，用来区分上面那个
                          置信度到底是统计概率还是模型自评
      emotion          —— 本地模型的完整信号（l1 升级判定、negativity、9 个簇
                          的分数、反讽标记等），供复核界面和事后调阈值用

    情绪服务挂掉时不抛异常：sentiment 保持大模型的兜底值，错误原因记在
    emotion.error 里。情绪是辅助信号，它不该让整封邮件收不到回复。
    """
    tags["model_sentiment"] = tags.get("sentiment")
    tags["model_sentiment_confidence"] = tags.get("sentiment_confidence")

    if isinstance(result, dict):
        tags["sentiment"] = result["sentiment"]
        tags["sentiment_confidence"] = _confidence(result.get("score"))
        tags["sentiment_source"] = "local_model"
        # sentiment 已经单独存了，emotion 块里不再重复一份
        tags["emotion"] = {k: v for k, v in result.items() if k != "sentiment"}
        return

    tags["sentiment_source"] = "llm_fallback"
    detail = (
        f"{type(result).__name__}: {result}" if isinstance(result, BaseException) else str(result)
    )
    tags["emotion"] = {"error": detail[:300]}


def _apply_language(tags: dict[str, Any], source_lang: str | None) -> None:
    """用 translation 层的语种判定覆盖 language，就地改写 tags。

    和 _apply_emotion() 同一个套路：确定性的判定盖过模型自评，模型那一份留档。
    这里的覆盖是必须的而不是可选的——大模型读到的是英文译文，它给的 language 只会
    是 "en"，把它写进标签等于把每一封外语来信都记成英文来信。

      model_language —— 大模型读译文得到的语种，几乎恒为 en，留着能看出译文是否生效
      language       —— 原文语种，来自翻译服务的 fasttext（服务不可用时是本地正则）

    这个语种是谁判的（服务端还是本地兜底）记在 thread 的 translation 块里，
    不在标签里重复一份。
    """
    tags["model_language"] = tags.get("language")
    if source_lang:
        tags["language"] = _one_of(source_lang, LANGUAGES, translation.UNKNOWN_LANG)


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

    # B类：本地情绪模型自己的升级判定。它读的是语气强度（辱骂、威胁、反复催促），
    # 和上面那条"情绪+紧急度"是两个独立信号——一封 urgency=low 的邮件照样可能被
    # 判成 P0_ESCALATE，所以这里单独判一次，不做与运算。
    emo = tags.get("emotion") or {}
    if emo.get("l1") == emotion.ESCALATION_L1:
        reasons.append(
            f"情绪模型判定为升级级别 {emo['l1']}（escalation_score={emo.get('escalation_score')}）"
        )
    # B类：反讽 —— 字面礼貌、实际负面（"Great job losing my package again"），
    # 自动回复最容易在这种邮件上翻车，一律转人工
    if emo.get("sarcasm_override"):
        reasons.append("情绪模型识别到反讽（字面积极、实际负面）")

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
    source_lang: str | None = None,
    translated: bool = False,
) -> dict[str, Any]:
    """对一封邮件做分类。入口函数，永不抛异常（详见模块文档字符串）。

    subject / body 传的是**英文基准文本**（translation.to_english() 的产出），
    `source_lang` 是原文语种、`translated` 说明这份文本是不是机翻来的。三个下游
    环节——大模型分类、本地情绪模型、英文关键词规则——都吃这份英文文本。
    """
    started = time.perf_counter()

    # 步骤 A：两个分类器并发跑——大模型读内容（意图/紧急度/实体/摘要），本地模型
    # 判语气（情绪）。两者是各自独立的进程，串行等待会把两边的耗时直接相加。
    # return_exceptions=True：任何一路挂掉都由下面各自的分支处理，不会让另一路
    # 已经拿到的结果跟着丢掉。
    raw, emotion_result = await asyncio.gather(
        llm.complete(
            SYSTEM_PROMPT,
            build_user_message(
                subject=subject, body=body, context=context,
                note=translation_note(source_lang, translated=translated),
            ),
            model=MODEL_NAME_TAGS,
        ),
        emotion.classify(f"{subject}\n\n{body}".strip() if subject.strip() else body),
        return_exceptions=True,
    )
    print(f"本地情绪模型结果: {emotion_result}")

    try:
        if isinstance(raw, BaseException):
            raise raw
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

    # 步骤 C：情绪以本地模型为准覆盖掉大模型的自评（服务不可用时保留兜底值）。
    # 必须排在规则引擎之前——下面的复核规则要读 sentiment 和 emotion.l1。
    _apply_emotion(tags, emotion_result)
    # 语种同理：以 translation 层的判定为准，大模型读的是译文，判不了原文语种。
    _apply_language(tags, source_lang)

    # 步骤 D：确定性规则引擎复核——不管模型自己判没判 needs_review，命中规则就强制转人工。
    # 这里读到的 subject/body 是英文基准文本，所以那几张英文关键词表对外语来信同样有效。
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
