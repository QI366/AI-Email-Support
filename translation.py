"""统一翻译层：把每一封来信先拉到英文基准，再交给下游所有模型。

    收到邮件 -> translation.to_english() -> 英文基准正文 + 原文语种
                                          |
                                          +-> tags.analyse()（大模型分类 / 本地情绪 / 关键词规则）
                                          +-> prompts + llm（回信写回**原文语种**）

-----
为什么要有这一层
-----
这条链路上除了写回信的大模型，其余每一个环节都是"只懂英文"的：

* 本地情绪模型（GoEmotions / roberta-base）只覆盖英文，遇到西语来信直接返回
  l1="AMBIGUOUS"、9 个簇全 0，等于整封信没有情绪判断，只能退回大模型自评；
* tags.py 里的人工复核关键词表（lawyer / chargeback / injured / hacked…）全是英文
  字面量，一封写着 "voy a llamar a mi abogado" 的信一条规则都命中不了；
* 打标签的提示词模板（email_automatic_reply_en_US_01.jinja2）本身是英文的，
  分类质量在英文输入上最稳。

所以把"翻译成英文"提到链路最前面，让后面所有的判断都在同一种语言上做——这不是为了
给人看译文，是为了让模型看到它们各自最擅长的输入。译文只是中间产物，**客户看到的
回信仍然是他自己的语言**：语种由这一层判定（`source_lang`），回信由大模型直接用
那个语种写（不是把英文回信再机翻回去，机翻回去的信读起来就是机翻）。

-----
服务契约
-----
POST $TRANSLATION_API_URL   body: {"text": "<原文>", "source_lang": "<可选，强制源语种>"}

    {
      "ok": true,
      "timestamp": "2026-08-03T03:00:48Z",
      "input": {"char_count": 66, "source_lang": null, "target_lang": "en"},
      "output": {
        "detected_primary_language": "es",       # fasttext lid.176 的判定
        "translated_text": "...",                # 整篇译文，段落间用 \n\n 连接
        "paragraphs": [{"paragraph_index": 0, "translation": "..."}],
        "segments": [{"paragraph_index": 0, "piece_index": 0,
                      "text": "...", "translation": "...",
                      "detected_language": "es", "used_language": "es"}]
      }
    }

失败时 HTTP 400/500 + {"ok": false, "error": "..."}。

服务端按空行切段、段内按 MAX_SEGMENT_CHARS（默认 600）再切片，逐片翻译后按
paragraph_index 拼回来，所以段落数进出一致——主题行作为第 0 段一起发过去、再从
paragraphs[0] 取回来，就能一次调用同时翻好主题和正文（见 to_english()）。

-----
两个已知的服务端行为，代码必须照顾到
-----
1. **英文进、英文出不是恒等变换。** 实测 "it still has not shipped" 会被改写成
   "it still hasn't been shipped"。改写无害，但一次调用在 CPU 上要十几秒，而且
   改的是客户的原话。所以本模块先用 is_english_baseline() 做一次本地判别，确认
   本来就是英文就直接跳过调用（TRANSLATION_SKIP_ENGLISH=0 可以关掉这个优化）。
2. **超出 9 种支持语言时 detected_primary_language 会报成 "en"。** 实测一封俄语
   来信译文完全正确（模型本身是多语言的），但语种字段给的是 "en"。所以本地判别
   还兼一个职责：脚本层面认出非拉丁文字（西里尔 / 阿拉伯 / 泰文…）时，源语种记
   "other"，回信退回英文，而不是让一封俄语信被当成英语信。
"""

from __future__ import annotations

import os
import re
import time
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx


class TranslationError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# 语种词表：与翻译服务 GET /languages 的 supported_languages 保持同步
# ---------------------------------------------------------------------------
SUPPORTED_LANGS = {
    "en": "English",
    "es": "Spanish",
    "de": "German",
    "fr": "French",
    "it": "Italian",
    "pt": "Portuguese",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
}

# 整条链路的基准语种。下游模型（情绪模型、关键词规则、分类模板）都只在这个语种上
# 有稳定表现，所以"翻译成英文"是手段，不是目标。
BASE_LANG = "en"

# 判不出来 / 不在支持列表里的语种。这是一个真实的取值，不是缺省占位——它的含义是
# "我们没有把握"，写进标签比硬猜一个语种诚实。
UNKNOWN_LANG = "other"

# 允许写回信的语种。回信语种必须落在这个集合里：模型写得出来是一回事，我们能不能
# 对回信质量负责是另一回事，只认服务声明支持的这 9 种，其余一律回英文。
REPLY_LANGS = tuple(SUPPORTED_LANGS)

# tags.py 的 language 白名单直接引用这里，加一种语言只改这个文件。
TAG_LANGUAGES = REPLY_LANGS + (UNKNOWN_LANG,)


def language_name(code: str | None) -> str:
    """ISO 639-1 -> 英文语种名。认不出来的原样返回，不编。"""
    if not code:
        return UNKNOWN_LANG
    return SUPPORTED_LANGS.get(code, code)


# ---------------------------------------------------------------------------
# 本地语种判别：翻译服务的兜底 + "要不要调翻译"的闸门
# ---------------------------------------------------------------------------
# 权威判别来自服务端的 fasttext lid.176，这里这套正则只干两件事：
#   a) 服务没配置 / 挂掉时兜底给一个语种，链路不能因为翻译挂了就不知道该用什么语言回信；
#   b) 判断"这封信本来就是英文"，是的话跳过那次十几秒的翻译调用。
# 两件事都容得下误判：a 的代价是回信语种可能不对，b 的代价是多花一次调用，
# 所以这里不引入 fasttext 之类的依赖，正则够用。

# 非拉丁文字。CJK 三种在支持列表里，能直接定语种；其余（西里尔 / 阿拉伯 / 希伯来 /
# 泰文 / 希腊 / 天城文）都不在服务支持的 9 种里，判成 UNKNOWN_LANG。
_HANGUL = re.compile(r"[가-힯ᄀ-ᇿ]")
_KANA = re.compile(r"[぀-ヿ]")
_HAN = re.compile(r"[一-鿿㐀-䶿豈-﫿]")
_OTHER_SCRIPT = re.compile(
    r"[Ͱ-ϿЀ-ӿ԰-֏֐-׿؀-ۿ"
    r"ऀ-ॿ฀-๿]"
)

# 拉丁字母语种的功能词表。取的是高频功能词加客服场景高频名词，词与词之间允许交叉
# （la / el 在西语和意语里都有），判别靠累计计数而不是单个词的独占性。
_LATIN_MARKERS = {
    "en": (
        r"\b(the|and|order|shipping|return|refund|please|thanks|thank you|hello|hi|"
        r"delivery|package|warranty|need|want|when|where|but|because|still|would|could|"
        r"my|your|have|has|not|this|that)\b"
    ),
    "es": (
        r"\b(hola|buenas|gracias|pedido|env[íi]o|devoluci[óo]n|reembolso|producto|compra|"
        r"entrega|paquete|factura|garant[íi]a|necesito|quiero|por favor|cu[áa]ndo|d[óo]nde|"
        r"el|la|los|las|mi|para|pero|porque|tambi[ée]n|todav[íi]a|est[áa]|muy)\b"
    ),
    "de": (
        r"\b(hallo|guten tag|danke|bestellung|lieferung|versand|r[üu]ckerstattung|paket|"
        r"garantie|rechnung|bitte|ich|nicht|und|der|die|das|mein|meine|noch|aber|weil|"
        r"sehr|wurde|haben)\b"
    ),
    "fr": (
        r"\b(bonjour|merci|commande|livraison|remboursement|colis|garantie|facture|"
        r"s'il vous pla[îi]t|je|mon|ma|mes|pas|et|le|la|les|des|mais|parce que|encore|"
        r"tr[èe]s|avec)\b"
    ),
    "it": (
        r"\b(ciao|salve|grazie|ordine|spedizione|consegna|rimborso|pacco|garanzia|fattura|"
        r"per favore|io|non|e|il|lo|la|gli|mio|mia|ma|perch[ée]|ancora|molto|sono)\b"
    ),
    "pt": (
        r"\b(ol[áa]|bom dia|obrigado|obrigada|pedido|entrega|envio|reembolso|encomenda|"
        r"garantia|fatura|por favor|eu|n[ãa]o|e|o|a|os|as|meu|minha|mas|porque|ainda|"
        r"muito|est[áa])\b"
    ),
}
_LATIN_PATTERNS = {lang: re.compile(src, re.IGNORECASE) for lang, src in _LATIN_MARKERS.items()}

# 专属字符：出现即给对应语种加权。ñ ¿ ¡ 只有西语用，ß ä ö ü 是德语，ã õ 是葡语，
# œ ê û ë 是法语。意大利语没有专属字符，只能靠词表——所以意语的判别最弱，这也是
# 为什么本地判别只做兜底，权威判定始终来自服务端。
_DIACRITICS = {
    "es": re.compile(r"[ñ¿¡]", re.IGNORECASE),
    "de": re.compile(r"[äöüß]", re.IGNORECASE),
    "pt": re.compile(r"[ãõ]", re.IGNORECASE),
    "fr": re.compile(r"[œêûëï]", re.IGNORECASE),
}
_DIACRITIC_WEIGHT = 3


def _script_language(text: str) -> str | None:
    """脚本层面能直接定下来的语种。定不下来返回 None，交给词表打分。"""
    if _HANGUL.search(text):
        return "ko"
    # 日文里汉字和假名混排，只要出现假名就是日文；只有汉字才是中文
    if _KANA.search(text):
        return "ja"
    if _HAN.search(text):
        return "zh"
    if _OTHER_SCRIPT.search(text):
        return UNKNOWN_LANG      # 服务支持的 9 种之外，别硬猜
    return None


def _latin_scores(text: str) -> dict[str, int]:
    scores = {lang: len(pat.findall(text)) for lang, pat in _LATIN_PATTERNS.items()}
    for lang, pat in _DIACRITICS.items():
        if pat.search(text):
            scores[lang] += _DIACRITIC_WEIGHT
    return scores


def detect_language(text: str) -> str:
    """本地兜底语种判别，只返回 SUPPORTED_LANGS 里的码或 UNKNOWN_LANG。

    一个字都没命中时兜底为 BASE_LANG——空邮件、纯订单号这类输入本来就没有语种信号，
    落到基准语种比落到 "other" 少一次无谓的降级。
    """
    if not text or not text.strip():
        return BASE_LANG

    by_script = _script_language(text)
    if by_script:
        return by_script

    scores = _latin_scores(text)
    best = max(scores, key=lambda lang: (scores[lang], lang == BASE_LANG))
    return best if scores[best] else BASE_LANG


def is_english_baseline(text: str) -> bool:
    """这封信是不是本来就在英文基准上——用来决定能不能跳过那次翻译调用。

    判定刻意保守：只要出现非拉丁文字、别的语种的专属字符，或者英文功能词没有明显
    占优，就算"不确定"，宁可多花一次调用。误判成 True 的代价是下游模型读到一封非
    英文邮件（情绪退回大模型自评，关键词规则失效），比多等十几秒贵得多。
    """
    if not text or not text.strip():
        return True
    if _script_language(text) is not None:
        return False
    for pat in _DIACRITICS.values():
        if pat.search(text):
            return False

    scores = _latin_scores(text)
    en = scores.get(BASE_LANG, 0)
    others = max((s for lang, s in scores.items() if lang != BASE_LANG), default=0)
    # 至少两个英文功能词，且严格多于任何一种其它语言：一句 "Order 12345?" 命中不了
    # 两个词，会被送去翻译——多一次调用，但语种由服务端说了算，更稳。
    return en >= 2 and en > others


# ---------------------------------------------------------------------------
# 模型档案：说明书页面上的"这到底是什么模型"
# ---------------------------------------------------------------------------
# 全部抄自官方发布物（模型卡 / 技术报告 / 仓库 README），**不是**我们自己测出来的。
# claims 里那几条尤其要当成厂商口径读：它们是 Hy-MT2 团队在自己的评测集上得到的
# 结论，和这套跑在一台 CPU 上、只开 9 种语言、只读客服邮件的部署不是一回事。
# 这套部署真正的成绩在测试台那些记录里——那才是我们自己测的。
#
# 放在这里而不是前端：换模型是改这一个文件的事，前端只负责翻译字段名。
MODEL_CARD = {
    "id": "tencent/Hy-MT2-1.8B",
    "home": "https://huggingface.co/tencent/Hy-MT2-1.8B",
    "paper": "https://arxiv.org/abs/2605.22064",
    "repo": "https://github.com/Tencent-Hunyuan/Hy-MT2",
    "vendor": "Tencent Hunyuan",
    "released": "2026-05-21",
    "license": "Apache-2.0",
    "params": "1.8B",
    # 不是 encoder-decoder 的专用翻译模型（OPUS-MT / NLLB 那一类），是一个因果
    # 语言模型：翻译任务靠提示词下达，所以它同时能听懂"术语表""保持格式"这类指令。
    "arch": "causal LM (AutoModelForCausalLM)",
    "task": "prompt-driven translation",
    # 模型自己支持 33 种，我们只开了 9 种（SUPPORTED_LANGS）。差额不是模型的限制，
    # 是我们的限制：能写回信 ≠ 我们能对那封回信的质量负责，见 REPLY_LANGS。
    "model_languages": 33,
    "served_languages": len(SUPPORTED_LANGS),
    "context_tokens": 4096,
    # 仓库 README 给 1.8B / 7B 的推荐解码参数。翻译服务端有没有照着设我们看不到，
    # 列出来是为了让人知道"同一段文字两次结果可能不同"——temperature 不是 0。
    "decoding": {
        "temperature": 0.7, "top_p": 0.6, "top_k": 20,
        "repetition_penalty": 1.05, "max_tokens": 4096,
    },
    "family": [
        {"id": "Hy-MT2-1.8B",     "params": "1.8B", "kind": "dense", "ours": True},
        {"id": "Hy-MT2-7B",       "params": "7B",   "kind": "dense", "ours": False},
        {"id": "Hy-MT2-30B-A3B",  "params": "30B",  "kind": "MoE · 3B active", "ours": False},
    ],
    # 厂商公布的结论，逐条标明来源口径。key 用来在前端取解释文案。
    "claims": [
        {"claim": "beats_commercial", "scope": "1.8B"},
        {"claim": "beats_open",       "scope": "7B / 30B-A3B"},
        {"claim": "quantized",        "scope": "1.8B · AngelSlim 1.25-bit"},
    ],
}

# 语种判别用的是另一个模型，不是 Hy-MT2 自己。这一点在排查"语种判错"时很关键：
# 译文和语种是两条独立的链路，译文对、语种错是常见组合（见 KNOWN_BEHAVIOURS）。
LID_CARD = {
    "id": "fasttext lid.176",
    "home": "https://fasttext.cc/docs/en/language-identification.html",
    "languages": 176,
    "role": "detected_primary_language / segment.detected_language",
}

# 服务端按段落切分的上限（模块文档里那条契约）。这是服务端的常量，我们从外部看不到
# 它的当前取值，只能按文档记下默认值——真要确认得去服务端读配置。
MAX_SEGMENT_CHARS = 600

# 一次调用从进到出的九步。第 6 步是唯一一次模型前向，其余八步都是确定性代码——
# 和情绪链路一样，把这件事画出来是为了说明"译文不稳定的地方只有一处"。
# where: client(我们这边) / service(翻译服务) / model(模型本身)
PIPELINE = (
    {"step": 1, "where": "client",  "key": "gate"},        # is_english_baseline() 闸门
    {"step": 2, "where": "client",  "key": "pack"},        # 主题当第 0 段拼进正文
    {"step": 3, "where": "service", "key": "paragraphs"},  # 按空行切段
    {"step": 4, "where": "service", "key": "segments"},    # 段内按 600 字切片
    {"step": 5, "where": "service", "key": "lid"},         # fasttext 逐片判语种
    {"step": 6, "where": "model",   "key": "generate"},    # 逐片翻译
    {"step": 7, "where": "service", "key": "rejoin"},      # 按 paragraph_index 拼回
    {"step": 8, "where": "client",  "key": "unpack"},      # paragraphs[0] 取回主题
    {"step": 9, "where": "client",  "key": "arbitrate"},   # 服务端语种 vs 本地脚本判别
)

# 响应里的字段，按说明书上该讲的顺序排。字段名是代码标识符不翻译，解释文案在前端
# i18n 里按名字取（tx_field_<name>）。改契约时这里和 parse_response() 一起改。
RESPONSE_FIELDS = (
    "ok", "detected_primary_language", "translated_text", "paragraphs", "segments",
    "input.char_count", "input.source_lang", "input.target_lang",
)

# 实测到的服务端行为。每一条都是**我们自己撞上的**，不是抄文档——evidence 里写的是
# 具体那次调用的输入和输出，SAMPLES 里各留了一条对应用例，谁都能在测试台上复现。
# severity 决定前端的颜色：warn 是"会影响下游判断"，info 是"知道就行"。
KNOWN_BEHAVIOURS = (
    {
        "key": "english_rewrite",
        "severity": "info",
        "sample": "en_passthrough",
        # 2026-08-03 实测，12.5s 换来一次改写：客户写的是 has not shipped
        "evidence": '"it still has not shipped" → "it hasn\'t been shipped yet"',
    },
    {
        "key": "unsupported_as_en",
        "severity": "warn",
        "sample": "ru_unsupported",
        # 2026-08-03 实测：译文完全正确（模型本身多语言），但语种字段是 en，
        # 而且 segment.detected_language 直接是 null——fasttext 认得出俄语，
        # 是服务端在"不在支持列表里"这一步把它压成了 en。
        "evidence": "俄语来信 → translated_text 正确，detected_primary_language=en，"
                    "segment.detected_language=null",
    },
    {
        "key": "short_segment_lid",
        "severity": "warn",
        "sample": "short_subject",
        # 2026-08-03 实测：主题 "Pedido roto" 判成 pt，同一封信的正文判成 es，
        # 整封的 detected_primary_language 跟着第 0 段取了 pt。
        "evidence": '"Pedido roto"(11 字) → pt；同一封信的正文 → es；整封报 pt',
    },
    {
        "key": "cpu_latency",
        "severity": "warn",
        "sample": "de_long_email",
        "evidence": "301 字 / 2 段 = 35.4s（CPU，2026-08-03 实测）",
    },
)

# 我们自己在这台机器上测出来的耗时。和 MODEL_CARD["claims"] 分开放，因为那些是厂商
# 口径、这些是本部署的实测——页面上这两块必须分得开。
# 全部来自 2026-08-03 对 TRANSLATION_API_URL 的直接调用，CPU 单机、无并发。
MEASURED = {
    "date": "2026-08-03",
    "device": "cpu",
    # 每一行都能在测试台上点一下复现（sample 就是那条内置用例的 id）。
    # 耗时几乎只跟**输出的 token 数**走，跟输入字数不成正比：11 字的主题也要 3.5 秒，
    # 因为模型仍要跑一次完整的前向 + 逐 token 解码。
    "runs": [
        {"sample": "short_subject",  "chars": 11,  "segments": 1, "ms": 3477},
        {"sample": "ru_unsupported", "chars": 76,  "segments": 1, "ms": 10353},
        {"sample": "en_passthrough", "chars": 81,  "segments": 1, "ms": 12506},
        {"sample": "de_long_email",  "chars": 301, "segments": 2, "ms": 35401},
    ],
}

# 英文基准文本的下游消费者。这一层存在的全部理由就是这三个，删掉翻译层就是这三个
# 一起退化——所以说明书上要把它们点名，而不是笼统说一句"提升分析质量"。
DOWNSTREAM = (
    {"key": "emotion",  "degrades": "l1=AMBIGUOUS，9 个簇全 0，退回大模型自评"},
    {"key": "keywords", "degrades": "英文关键词表一条都命中不了，人工复核漏判"},
    {"key": "template", "degrades": "英文分类模板读非英文输入，意图/紧急度质量下降"},
)


# ---------------------------------------------------------------------------
# 示例语料：翻译测试台的"一键填入"用例
# ---------------------------------------------------------------------------
# expect 是**这段文字实际是什么语种**（人判的），不是服务会返回什么。故意留了三条
# 已知会不一致的：短主题（LID 在两个词上不可靠）、俄语（不在支持的 9 种里）、英语
# （进出不是恒等变换）。测试台的价值就在于让人看见这些，把用例改成服务稳过的句子
# 等于把体温计调到 36.5 度。
SAMPLES = (
    {"id": "es_broken", "expect": "es", "kind": "normal",
     "text": "Mi pedido llegó roto y nadie me responde. Estoy muy molesto."},
    {"id": "de_warranty", "expect": "de", "kind": "normal",
     "text": "Die Jacke hat nach zwei Wochen einen Riss bekommen. Gilt dafür noch die Garantie?"},
    # 唯一一条多段用例：段落切分、逐段翻译、按 paragraph_index 拼回，这条能一次看全。
    # 也是耗时那张表里最长的一条——整封信在 CPU 上要 35 秒，这个数字得让人看见。
    {"id": "de_long_email", "expect": "de", "kind": "normal",
     "text": "Sehr geehrtes Support-Team,\n\nich habe vor drei Wochen eine Jacke bestellt und "
             "bisher keine Versandbestätigung erhalten. Die Bestellnummer lautet 12345. Ich habe "
             "bereits zweimal geschrieben und keine Antwort bekommen. Bitte teilen Sie mir mit, "
             "wann das Paket ankommt, sonst möchte ich mein Geld zurück."},
    {"id": "fr_refund", "expect": "fr", "kind": "normal",
     "text": "Bonjour, je souhaite être remboursé. Le colis n'est jamais arrivé et personne ne me répond."},
    {"id": "it_delay", "expect": "it", "kind": "normal",
     "text": "Ho ordinato due settimane fa e non è ancora stato spedito. Quando arriva il pacco?"},
    {"id": "pt_tracking", "expect": "pt", "kind": "normal",
     "text": "Olá, podem confirmar o código de rastreio da encomenda 12345? Ainda não recebi nada."},
    {"id": "zh_size", "expect": "zh", "kind": "normal",
     "text": "你好，我想问一下这件外套的中码具体是多少厘米？我平时穿 M 码。"},
    {"id": "ja_delay", "expect": "ja", "kind": "normal",
     "text": "先週注文した商品がまだ発送されていません。いつ届くか教えていただけますか。"},
    {"id": "ko_refund", "expect": "ko", "kind": "normal",
     "text": "주문한 상품이 파손된 상태로 도착했습니다. 환불해 주세요."},
    # 以下三条是"故意会翻车"的用例，说明书上点名的三条已知行为各对应一条
    {"id": "en_passthrough", "expect": "en", "kind": "edge",
     "text": "Where is my order? I ordered a jacket two weeks ago and it still has not shipped."},
    {"id": "ru_unsupported", "expect": "other", "kind": "edge",
     "text": "Здравствуйте! Мой заказ до сих пор не отправлен. Верните деньги, пожалуйста."},
    {"id": "short_subject", "expect": "es", "kind": "edge",
     "text": "Pedido roto"},
)

SAMPLE_IDS = tuple(s["id"] for s in SAMPLES)


def model_card() -> dict[str, Any]:
    """模型档案的副本。给出去的是副本，免得调用方改到模块级常量。"""
    card = dict(MODEL_CARD)
    card["decoding"] = dict(MODEL_CARD["decoding"])
    card["family"] = [dict(m) for m in MODEL_CARD["family"]]
    card["claims"] = [dict(c) for c in MODEL_CARD["claims"]]
    return card


def spec() -> dict[str, Any]:
    """链路规格：九步管线、响应契约、已知行为、下游消费者。说明书页面的数据源。"""
    return {
        "pipeline": [dict(s) for s in PIPELINE],
        "response_fields": list(RESPONSE_FIELDS),
        "known_behaviours": [dict(b) for b in KNOWN_BEHAVIOURS],
        "downstream": [dict(d) for d in DOWNSTREAM],
        "max_segment_chars": MAX_SEGMENT_CHARS,
        "lid": dict(LID_CARD),
    }


def vocabulary() -> dict[str, Any]:
    """我们开放的语种词表，以及每一种的角色。

    三件事要分清，说明书上最容易被问的也是这三件：
      * 模型支持 33 种，我们只**开** 9 种；
      * 这 9 种既是"能被识别出来的来信语种"，也是"能收到母语回信的语种"；
      * 第 10 个取值 other 不是"没识别出来"，是"不在这 9 种里"——这类来信照样翻成
        英文做分析（模型多语言能力覆盖得到），只是回信退回英文。
    """
    return {
        "base_lang": BASE_LANG,
        "unknown_lang": UNKNOWN_LANG,
        "languages": [
            {"code": code, "name": name, "base": code == BASE_LANG, "reply": True}
            for code, name in SUPPORTED_LANGS.items()
        ],
        "reply_langs": list(REPLY_LANGS),
        "tag_languages": list(TAG_LANGUAGES),
        "model_languages": MODEL_CARD["model_languages"],
    }


# ---------------------------------------------------------------------------
# 服务调用
# ---------------------------------------------------------------------------
def config() -> dict[str, Any]:
    url = (os.getenv("TRANSLATION_API_URL") or "").strip().strip('"').strip("'")
    # 1.8B 的模型跑在 CPU 上，一段短文本就要十几秒，长邮件按 600 字切片后逐片翻，
    # 默认超时给到 120 秒。宁可等，也不要让一封长信中途断掉退回原文。
    timeout = float(os.getenv("TRANSLATION_TIMEOUT") or 120)
    skip_english = (os.getenv("TRANSLATION_SKIP_ENGLISH") or "1").strip().lower() not in (
        "0", "false", "no", "off",
    )
    return {
        "url": url,
        "enabled": bool(url),
        "timeout": timeout,
        "skip_english": skip_english,
        "base_lang": BASE_LANG,
        "languages": dict(SUPPORTED_LANGS),
    }


def _paragraphs(payload: dict[str, Any]) -> list[str]:
    """按 paragraph_index 取回逐段译文。缺字段就返回空列表，由调用方退回整篇译文。"""
    raw = payload.get("paragraphs")
    if not isinstance(raw, list):
        return []
    out: list[tuple[int, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            return []
        idx = item.get("paragraph_index")
        text = item.get("translation")
        if not isinstance(idx, int) or not isinstance(text, str):
            return []
        out.append((idx, text.strip()))
    return [text for _, text in sorted(out, key=lambda p: p[0])]


def parse_response(payload: Any) -> dict[str, Any]:
    """把服务响应整理成 {text, paragraphs, source_lang}。译文为空一律当失败。"""
    if not isinstance(payload, dict):
        raise TranslationError(f"Unexpected response shape: {str(payload)[:200]}")
    if payload.get("ok") is False:
        raise TranslationError(f"Translation API refused: {str(payload.get('error'))[:200]}")

    output = payload.get("output")
    if not isinstance(output, dict):
        raise TranslationError(f"Response carried no output block: {str(payload)[:200]}")

    text = str(output.get("translated_text") or "").strip()
    paragraphs = _paragraphs(output)
    if not text and paragraphs:
        text = "\n\n".join(p for p in paragraphs if p)
    if not text:
        raise TranslationError("Translation API returned an empty translation.")

    lang = str(output.get("detected_primary_language") or "").strip().lower()
    return {
        "text": text,
        "paragraphs": paragraphs,
        # 不在支持列表里的语种服务端会报成 en（见模块文档），所以这里不做纠正，
        # 纠正交给 to_english()：那里还有本地判别的结果可以对照。
        "source_lang": lang if lang in SUPPORTED_LANGS else "",
    }


async def translate(text: str, *, source_lang: str | None = None) -> dict[str, Any]:
    """调一次翻译服务。失败抛 TranslationError，由调用方决定怎么兜底。

    不做截断：邮件正文在 API 层已经限长（server.MAX_BODY），服务端自己按段落和
    600 字切片，在客户端再切一刀只会把信的后半截丢掉。
    """
    cfg = config()
    if not cfg["enabled"]:
        raise TranslationError(
            "No translation endpoint configured. Set TRANSLATION_API_URL in the .env "
            "file next to server.py."
        )
    if not (text or "").strip():
        raise TranslationError("Empty text.")

    body: dict[str, Any] = {"text": text}
    if source_lang in SUPPORTED_LANGS:
        body["source_lang"] = source_lang

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=cfg["timeout"]) as client:
            resp = await client.post(cfg["url"], json=body)
    except httpx.HTTPError as exc:
        raise TranslationError(f"{type(exc).__name__}: {exc}"[:300]) from exc

    if resp.status_code >= 400:
        raise TranslationError(f"Translation API returned {resp.status_code}: {resp.text[:300]}")
    try:
        payload = resp.json()
    except ValueError as exc:
        raise TranslationError(f"Translation API returned non-JSON: {resp.text[:300]}") from exc

    record = parse_response(payload)
    record["latency_ms"] = int((time.perf_counter() - started) * 1000)
    return record


def resolve_source_lang(*, service_lang: str, text: str, local_guess: str) -> tuple[str, str]:
    """服务端语种 vs 本地判别的仲裁。返回 (source_lang, lang_source)。

    语种以服务端（fasttext）为准——它比这边的正则强得多，拉丁字母语种之间的分歧一律
    听服务端的。只有两种情况用本地结果：
      a) 服务端根本没给语种（或给了个不在支持列表里的值）；
      b) 服务端报了 en，但脚本层面明摆着不是拉丁字母（西里尔 / CJK…）——这就是模块
         文档里那条"超出支持范围报成 en"的已知行为，一封俄语信不该被当成英语信。

    单独抽出来是因为测试台要展示"生产链路会怎么判"，而不是自己再实现一遍——两份
    实现迟早会分叉，那时候测试台展示的就是一条不存在的链路。
    """
    script_guess = _script_language(text)
    if not service_lang:
        return local_guess, "local"
    if service_lang == BASE_LANG and script_guess is not None:
        return script_guess, "local"
    return service_lang, "service"


# ---------------------------------------------------------------------------
# 服务状态探针：说明书页面上的"现在这台机器上跑的到底是什么"
# ---------------------------------------------------------------------------
def _sibling_url(path: str) -> str:
    """把 TRANSLATION_API_URL 的最后一段换成 path（/translate -> /health）。"""
    url = (os.getenv("TRANSLATION_API_URL") or "").strip().strip('"').strip("'")
    if not url:
        return ""
    parts = urlsplit(url)
    base = parts.path.rsplit("/", 1)[0]
    return urlunsplit((parts.scheme, parts.netloc, f"{base}/{path}", "", ""))


async def probe() -> dict[str, Any]:
    """问一次翻译服务"你现在是什么状态"。**永不抛异常**，问不到就 ok=False。

    说明书页面上写死一个模型名是没有意义的——真正该回答的问题是"此刻这个端点后面
    加载的是哪个模型、跑在什么设备上、fasttext 起来了没有"。这些只有服务自己知道，
    所以这里直接问它，而不是拿 MODEL_CARD 里的常量冒充现场事实。
    """
    health_url = _sibling_url("health")
    langs_url = _sibling_url("languages")
    if not health_url:
        return {"ok": False, "error": "not_configured"}

    async def _get(client: httpx.AsyncClient, url: str) -> dict[str, Any] | None:
        try:
            resp = await client.get(url)
        except httpx.HTTPError:
            return None
        if resp.status_code >= 400:
            return None
        try:
            payload = resp.json()
        except ValueError:
            return None
        return payload if isinstance(payload, dict) else None

    try:
        # 探针要快：状态问不到就退回 MODEL_CARD 讲静态档案，不值得让页面等 120 秒
        async with httpx.AsyncClient(timeout=5.0) as client:
            health = await _get(client, health_url)
            langs = await _get(client, langs_url)
    except Exception as exc:  # noqa: BLE001 - 探针永不抛
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:200]}

    if not health and not langs:
        return {"ok": False, "error": "unreachable"}

    status = (health or {}).get("status")
    status = status if isinstance(status, dict) else {}
    data = (langs or {}).get("data")
    data = data if isinstance(data, dict) else {}
    served = data.get("supported_languages")
    served = served if isinstance(served, dict) else {}

    return {
        "ok": True,
        "service": str((health or {}).get("service") or "")[:60] or None,
        "device": str(status.get("device") or "")[:20] or None,
        "model_path": str(status.get("model_path") or data.get("model_path") or "")[:120] or None,
        "model_loaded": bool(status.get("model_loaded") or data.get("model_ready")),
        "tokenizer_loaded": bool(status.get("tokenizer_loaded")),
        "fasttext_ready": bool(status.get("fasttext_ready") or data.get("fasttext_ready")),
        "fasttext_path": str(data.get("fasttext_model_path") or "")[:200] or None,
        "served_languages": sorted(served),
        # 服务开放的语种和我们这边的词表对不上，说明有一边改了而另一边没跟——
        # 这不是崩溃，但页面必须说出来，否则 SUPPORTED_LANGS 会悄悄过期。
        "drift": sorted(set(served) ^ set(SUPPORTED_LANGS)) if served else [],
    }


# ---------------------------------------------------------------------------
# 测试台：拿一段文字直接问服务，把能看的都带回来
# ---------------------------------------------------------------------------
async def inspect(text: str) -> dict[str, Any]:
    """跑一次翻译并把整条判断链摊开。失败抛 TranslationError，由调用方落库。

    和 to_english() 的区别是**不走跳过英文的闸门**：测试台测的是模型本身，把英文
    输入悄悄跳过去等于让测试台只展示模型顺利的那一面。闸门的判定照样算出来放进
    gate 字段——"生产链路在这句话上会不会调服务"本身就是要看的东西之一。
    """
    cfg = config()
    if not cfg["enabled"]:
        raise TranslationError(
            "No translation endpoint configured. Set TRANSLATION_API_URL in the .env "
            "file next to server.py."
        )
    body = (text or "").strip()
    if not body:
        raise TranslationError("Empty text.")

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=cfg["timeout"]) as client:
            resp = await client.post(cfg["url"], json={"text": body})
    except httpx.HTTPError as exc:
        raise TranslationError(f"{type(exc).__name__}: {exc}"[:300]) from exc

    if resp.status_code >= 400:
        raise TranslationError(f"Translation API returned {resp.status_code}: {resp.text[:300]}")
    try:
        payload = resp.json()
    except ValueError as exc:
        raise TranslationError(f"Translation API returned non-JSON: {resp.text[:300]}") from exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    record = parse_response(payload)          # 译文为空 / ok=false 一律当失败
    output = payload.get("output")
    output = output if isinstance(output, dict) else {}

    # 服务端原样报的语种，**不过白名单**——"报了个我们没开的语种"和"没报"是两回事，
    # 页面要能把这两种情况分开显示（ru_unsupported 那条已知行为就靠这个看出来）。
    raw_lang = str(output.get("detected_primary_language") or "").strip().lower() or None
    local_guess = detect_language(body)
    source_lang, lang_source = resolve_source_lang(
        service_lang=record["source_lang"], text=body, local_guess=local_guess,
    )

    return {
        "char_count": len(body),
        "latency_ms": latency_ms,
        "chars_per_s": round(len(body) / (latency_ms / 1000), 1) if latency_ms else None,
        # 服务端说的
        "raw_lang": raw_lang,
        "raw_lang_supported": raw_lang in SUPPORTED_LANGS if raw_lang else False,
        "translated_text": record["text"],
        "paragraphs": record["paragraphs"],
        "segments": _segments(output),
        # 我们这边算的
        "local_lang": local_guess,
        "script_lang": _script_language(body),
        "gate_skips": is_english_baseline(body),
        # 仲裁之后真正会写进标签的那个值
        "source_lang": source_lang,
        "lang_source": lang_source,
    }


def _segments(output: dict[str, Any]) -> list[dict[str, Any]]:
    """逐片明细。片是服务端切的，逐片的 detected_language 就是"整封语种"的来源，
    页面上要能看到某一片和整封判得不一样（short_segment_lid 那条已知行为）。
    """
    raw = output.get("segments")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:40]:
        if not isinstance(item, dict):
            continue
        out.append({
            "paragraph_index": item.get("paragraph_index") if isinstance(item.get("paragraph_index"), int) else None,
            "piece_index": item.get("piece_index") if isinstance(item.get("piece_index"), int) else None,
            "text": str(item.get("text") or "")[:600],
            "translation": str(item.get("translation") or "")[:600],
            "detected_language": str(item.get("detected_language") or "").strip().lower() or None,
            "used_language": str(item.get("used_language") or "").strip().lower() or None,
        })
    return out


def _record(
    *,
    subject: str,
    body: str,
    source_lang: str,
    lang_source: str,
    translated: bool,
    skipped: str | None = None,
    latency_ms: int | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        # 英文基准文本。没翻译时就是原文——下游拿到的字段永远是"能读的那一份"，
        # 不需要每个调用方各写一遍 `translated and en or original` 的三元式。
        "subject": subject,
        "body": body,
        "source_lang": source_lang,
        "source_language_name": language_name(source_lang),
        "lang_source": lang_source,          # service | local
        "translated": translated,
        "skipped": skipped,                  # already_english | not_configured | None
        "latency_ms": latency_ms,
        "error": error,
    }


async def to_english(*, subject: str = "", body: str) -> dict[str, Any]:
    """流程入口：把一封信整体拉到英文基准，并给出原文语种。**永不抛异常。**

    和 tags.analyse() 一样的约定：翻译是链路增强，服务挂了不能导致客户收不到回信。
    出错时退回原文 + 本地语种判别，错误原因记在 error 里，下游照常跑——只是情绪
    模型和关键词规则会在非英文输入上退化，这是可观测的降级，不是静默失败。

    主题和正文用**一次**调用翻完：主题作为第 0 段拼在正文前面发过去，服务端按空行
    切段且段落数进出一致，所以 paragraphs[0] 就是主题的译文。段落数对不上时（服务
    端改了切分口径）退回整篇译文当正文、主题保留原文——宁可主题不译，也不要把正文
    的第一段错当成主题。
    """
    subject = (subject or "").strip()
    body = (body or "").strip()
    combined = f"{subject}\n\n{body}" if subject else body

    cfg = config()
    if not cfg["enabled"]:
        return _record(
            subject=subject, body=body,
            source_lang=detect_language(combined), lang_source="local",
            translated=False, skipped="not_configured",
        )

    if cfg["skip_english"] and is_english_baseline(combined):
        return _record(
            subject=subject, body=body,
            source_lang=BASE_LANG, lang_source="local",
            translated=False, skipped="already_english",
        )

    local_guess = detect_language(combined)
    try:
        result = await translate(combined)
    except TranslationError as exc:
        return _record(
            subject=subject, body=body,
            source_lang=local_guess, lang_source="local",
            translated=False, error=str(exc)[:300],
        )
    except Exception as exc:  # noqa: BLE001 - 永不抛异常的约定就是重点
        return _record(
            subject=subject, body=body,
            source_lang=local_guess, lang_source="local",
            translated=False, error=f"{type(exc).__name__}: {exc}"[:300],
        )

    paragraphs = result["paragraphs"]
    if subject and len(paragraphs) >= 2:
        en_subject = paragraphs[0]
        en_body = "\n\n".join(p for p in paragraphs[1:] if p) or result["text"]
    elif subject:
        en_subject = subject             # 段落数对不上，主题保留原文
        en_body = result["text"]
    else:
        en_subject = ""
        en_body = result["text"]

    # 服务端的判定优先，两种情况退回本地——规则在 resolve_source_lang() 里，
    # 翻译测试台展示的也是同一个函数的结果。
    source_lang, lang_source = resolve_source_lang(
        service_lang=result["source_lang"], text=combined, local_guess=local_guess,
    )

    return _record(
        subject=en_subject, body=en_body,
        source_lang=source_lang, lang_source=lang_source,
        translated=True, latency_ms=result["latency_ms"],
    )


def to_prompt_block(record: dict[str, Any] | None) -> dict[str, str] | None:
    """给 prompts.build_user_message() 的英文译文块。没真正翻译过就返回 None——
    原文本来就是英文时再塞一份"译文"，只会让写信的模型以为有两封不同的信。
    """
    if not record or not record.get("translated"):
        return None
    return {"subject": record.get("subject") or "", "body": record.get("body") or ""}
