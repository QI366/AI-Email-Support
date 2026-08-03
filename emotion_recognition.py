"""
用户情绪识别：本地情绪模型服务的客户端 + 情绪簇（cluster）词表定义。

    incoming email -> emotion.classify() -> 9 个情绪簇打分 -> tags["sentiment"]

-----
为什么不用大模型判情绪
-----
情绪是"语气"，不是"事实"，大模型给的 sentiment 和它给的 sentiment_confidence 一样
是自评，既不可复现也无法校准。本地这套模型（GoEmotions 28 标签 -> 9 个情绪簇）给出
的是真正的模型概率，同一封邮件永远得到同一个分数，也能对着阈值做回归测试。

所以 tags.py 里的 sentiment 现在由这里产出，大模型只保留 intent / urgency / entities
/ summary 这些"读内容"的活儿。大模型自己那一份情绪判断仍然保留在
tags["model_sentiment"] 里，只在本地服务不可用时作为兜底顶上。

-----
服务契约
-----
POST $EMOTION_API_URL   body: {"text": "<整封邮件>"}

    {
      "l1": "P0_ESCALATE" | "P1_RISK" | "P2_STANDARD" | "P3_LOW",  # 服务自己的升级判定
      "escalation_score": 0.0-1.0,
      "negativity": -1.0-1.0,        # 负值偏正面，正值偏负面
      "l2": {"HOSTILE": 0.0062, ...},  # 9 个情绪簇，多标签打分，不归一
      "l3_raw": {"anger": 0.0062, ...},  # 28 个 GoEmotions 原始标签
      "rule_hits": ["legal", ...],   # 服务端关键词规则命中
      "sarcasm_override": bool,      # 反讽识别：字面积极但实际是负面
      "sarcasm_kind": str,
      "flags": {"allcaps": bool, "repetition": bool, "sarcasm": bool},
      "n_sentences": int,
      "ambiguous_reason": str,
      "preprocessing": {"stripped_quote": bool, "stripped_sig": bool}
    }

l2 是多标签打分而不是一个 softmax 分布——一封邮件可以同时 HOSTILE 0.85 和
FRUSTRATED 0.85（骂人的邮件通常两者都有）。取分最高的簇作为 sentiment，最高分
下方 TIE_BAND 之内的都算并列，并列里取极性最负的那个（宁可多转一次人工，不要
漏掉一个愤怒客户）。

l3_raw 只在服务没给 l2 时用来兜底聚合，不写进标签记录——28 个浮点数存进每一条
thread 的 tags_json 里性价比太低，需要排查时看服务端日志。
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

import httpx


class EmotionError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# 情绪簇定义：与情绪服务端保持同步
# ---------------------------------------------------------------------------
# 28 个 GoEmotions 标签 -> 9 个业务上"要采取不同动作"的簇。分簇的依据是客服动作
# 而不是心理学分类：两个标签只要触发同一套回复策略，就归进同一个簇。
CLUSTERS = {
    "HOSTILE":     ["anger", "disgust"],
    "FRUSTRATED":  ["annoyance", "disappointment", "disapproval"],
    "ANXIOUS":     ["fear", "nervousness", "sadness", "grief"],
    "CONFUSED":    ["confusion", "curiosity", "surprise", "realization"],
    "DEMANDING":   ["desire"],
    "NEUTRAL":     ["neutral"],
    # admiration 在 SATISFIED：它是"赞赏产品"不是"感谢客服"，业务动作不同
    "GRATEFUL":    ["gratitude", "relief"],
    "SATISFIED":   ["joy", "excitement", "approval", "optimism",
                    "love", "pride", "amusement", "admiration"],
    "SELF_BLAME":  ["remorse", "embarrassment"],
}

NEGATIVE_CLUSTERS = ("HOSTILE", "FRUSTRATED", "ANXIOUS")
POSITIVE_CLUSTERS = ("GRATEFUL", "SATISFIED")

POLARITY = {
    "HOSTILE": -1.0, "FRUSTRATED": -0.6, "ANXIOUS": -0.5,
    "DEMANDING": -0.2, "CONFUSED": 0.0, "NEUTRAL": 0.0,
    "SELF_BLAME": 0.1, "GRATEFUL": 0.7, "SATISFIED": 0.8,
}

# caring 不进任何簇：它既可能是买家在体谅客服，也可能是客服话术的回声，
# 两种情况的业务动作不同，硬塞进某个簇只会污染那个簇的分数。
UNMAPPED_LABELS = ("caring",)

# v3：池化方式。NEUTRAL 是"情绪的缺席"，跨句 max-pool 意味着只要有一句事务性
# 陈述整封邮件就变 NEUTRAL —— 而任何多句邮件都必然含至少一句事务性陈述。
# confused_001 挂在这里："I usually wear a medium in US sizing." 单句 neutral 0.878。
#
# 跨句池化在服务端做，这里记下来只是为了让读代码的人知道 l2 是怎么来的。
# 对着线上服务实测过 NEUTRAL 确实不走 max：两句事务性陈述给 0.935，再追加一句
# "I am furious that nobody has replied." 之后掉到 0.150，而同一次调用里 HOSTILE
# 取到了 0.780（就是那一句的分，标准 max 行为）。具体是不是算术平均没法从外部确定，
# 所以这里只记"不是 max"，别把 "mean" 当成服务端的精确实现来引用。
POOLING = {"NEUTRAL": "not_max"}       # 其余默认 max

# 服务端词表（大写）与标签层词表（小写）。tags.SENTIMENTS 直接引用后者，
# 前端的 SENTIMENT_ORDER / 配色也照这份词表来。
CLUSTER_NAMES = tuple(CLUSTERS)
SENTIMENTS = tuple(c.lower() for c in CLUSTER_NAMES)
NEGATIVE_SENTIMENTS = tuple(c.lower() for c in NEGATIVE_CLUSTERS)
POSITIVE_SENTIMENTS = tuple(c.lower() for c in POSITIVE_CLUSTERS)

# 服务端的升级判定，P0 最严重。tags 层拿它当"确定性升级信号"用（见 _apply_review_rules）。
L1_LEVELS = ("P0_ESCALATE", "P1_RISK", "P2_STANDARD", "P3_LOW", "AMBIGUOUS")
ESCALATION_L1 = "P0_ESCALATE"

# 服务读不了这封邮件时给的 l1（已知触发条件：ambiguous_reason="unsupported_language"，
# 模型只覆盖英文）。这种响应里 9 个簇全是 0.0——直接拿去 argmax 会因为"并列取最负"
# 把每一封西班牙语来信都判成 hostile，所以必须当成"没有结果"抛出去，让 tags 层退回
# 大模型的情绪判断。大模型是多语言的，这正是它该顶上的场景。
AMBIGUOUS_L1 = "AMBIGUOUS"

# 并列判定带宽。l2 是多标签打分而不是 softmax，一封又急又气的邮件常常在两三个簇上
# 拿到几乎一样的分数：实测 "I ordered a jacket two weeks ago… I want my money back"
# 的 CONFUSED 是 0.5772、FRUSTRATED 是 0.5720，差 0.005，纯 argmax 的胜负完全落在
# 噪声里，而这封邮件判成 confused 就不会触发"情绪 + 紧急度双高"的人工复核。
# 所以落在最高分下方 TIE_BAND 之内的簇一律算并列，并列里取极性最负的那个。
# 设成 0（EMOTION_TIE_BAND=0）即退回纯 argmax。
TIE_BAND = float(os.getenv("EMOTION_TIE_BAND") or 0.05)


# ---------------------------------------------------------------------------
# 模型档案：说明书页面上的"这到底是什么模型"
# ---------------------------------------------------------------------------
# 全部抄自模型卡（huggingface.co/SamLowe/roberta-base-go_emotions），不是我们自己
# 测出来的。metrics 是 GoEmotions 测试集上的成绩，**不是**这套部署在客服邮件上的
# 成绩——训练语料是 Reddit 评论，和收件箱里的英文差着一个领域，页面上必须写清楚。
#
# 放在这里而不是前端：换模型是改这一个文件的事，前端只负责翻译字段名。
MODEL_CARD = {
    "id": "SamLowe/roberta-base-go_emotions",
    "home": "https://huggingface.co/SamLowe/roberta-base-go_emotions",
    "base": "roberta-base",
    "params": "≈125M",
    "task": "multi-label sigmoid",   # 不是 softmax：28 个标签各自独立，加起来不等于 1
    "raw_labels": 28,                # 27 种情绪 + neutral
    "dataset": "go_emotions",
    "dataset_home": "https://huggingface.co/datasets/google-research-datasets/go_emotions",
    "dataset_size": "58k Reddit comments (~43k train)",
    "language": "English",
    "license": "MIT",
    "epochs": 3,
    "learning_rate": "2e-5",
    "weight_decay": 0.01,
    "default_threshold": 0.5,
    # 模型卡给的两组整体指标：默认 0.5 阈值，以及每个标签单独调过阈值之后。
    # accuracy 是子集精确匹配（28 个标签全对才算对），所以调阈值多预测标签之后
    # 它反而降了，而 f1 升了——这不是打错字。
    "metrics": [
        {"setting": "threshold_0.5",
         "accuracy": 0.474, "precision": 0.575, "recall": 0.396, "f1": 0.450},
        {"setting": "tuned_thresholds",
         "accuracy": 0.396, "precision": 0.542, "recall": 0.577, "f1": 0.541},
    ],
    # 各标签之间差距极大，平均分掩盖了这件事：gratitude 有大量样本所以很准，
    # grief / pride / relief 训练样本太少，模型卡上的 F1 直接是 0.000。
    "best_label": {"label": "gratitude", "f1": 0.919},
    "worst_labels": ["grief", "pride", "relief"],
    # 服务端文档给的域偏移估计：零样本准确率预计比论文报告值低这么多个点。
    # 是估计不是实测——真正的实测就是测试台上那些记录。
    "domain_shift_points": [10, 15],
    "finetune_advice": {"examples": "3–5k", "method": "LoRA"},
}

# 服务响应里的字段，按说明书上该讲的顺序排。字段名是代码标识符不翻译，解释文案
# 在前端 i18n 里按名字取（emo_field_<name>）。改契约时这里和 parse_response()
# 一起改，页面就不会讲一份过期的契约。
RESPONSE_FIELDS = (
    "l1", "escalation_score", "negativity", "l2", "l3_raw", "rule_hits",
    "sarcasm_override", "flags", "n_sentences", "ambiguous_reason", "preprocessing",
)


# ---------------------------------------------------------------------------
# 聚合层规格：服务端 Emotion Aggregator 的分层、路由与规则
# ---------------------------------------------------------------------------
# 抄自服务端的设计文档，用来给说明书页面提供数据。这一段描述的是**服务端**的行为，
# 我们这边只是调用方——它变了这里就要跟着改，否则页面会讲一份过期的规格。
#
# 服务端把模型的 28 维输出摊成三层，各层的用途完全不同：
#
#   L1 处置层（5 类）  决定 SLA / 是否转人工
#   L2 语义层（9 类）  决定回复策略，也就是我们写进 tags["sentiment"] 的那一层
#   L3 原始层（28 类） 存库，供阈值调优和标签漂移监控
#
# 我们只取 L2 的 argmax 当 sentiment，L1 当确定性升级信号（见 tags._apply_review_rules）。
LAYERS = (
    {"layer": "L1", "size": 5,  "field": "l1"},
    {"layer": "L2", "size": len(CLUSTERS), "field": "l2"},
    {"layer": "L3", "size": 28, "field": "l3_raw"},
)

# L1 各档对应的动作与 SLA。sla_hours=None 表示这一档不做情绪路由，按意图分类走。
L1_ACTIONS = {
    "P0_ESCALATE": {"sla_hours": 2,    "automation": "none"},
    "P1_RISK":     {"sla_hours": 8,    "automation": "draft"},
    "P2_STANDARD": {"sla_hours": 24,   "automation": "auto"},
    "P3_LOW":      {"sla_hours": 48,   "automation": "template"},
    "AMBIGUOUS":   {"sla_hours": None, "automation": "bypass"},
}

# 连续升级分。服务端 v1 用 if-else 级联判 L1，有两个结构性问题：单簇不过阈值就整体
# 降级（"第三次问了，我要退款"里 FRUSTRATED 和 DEMANDING 各差一点，叠加起来显然该升级）；
# 正向簇能单独决定 L1（带敌意的礼貌投诉会先命中 P3 分支）。v2 改成负面簇加权取最大、
# 叠加修饰项、再按档位切分，正向簇降格为 P3 的准入条件。
ESCALATION = {
    "weights": {"HOSTILE": 1.00, "FRUSTRATED": 0.85, "ANXIOUS": 0.70},
    "modifiers": {"demanding": 0.15, "repetition": 0.20, "allcaps": 0.15, "sarcasm": 0.25},
    "demanding_trigger": 0.40,
    # 分档自高到低，第一个满足的胜出；都不满足才看下面的 p3_gate / fallback
    "bands": (("P0_ESCALATE", 0.60), ("P1_RISK", 0.32), ("P2_STANDARD", 0.15)),
    "p3_gate": {"negative_max": 0.20, "positive_min": 0.45},
    "fallback": {"NEUTRAL": 0.55, "CONFUSED": 0.40, "SELF_BLAME": 0.25},
}

# 威胁检测：命中任意一条直接 P0，**不看情绪分**。亚马逊买家的威胁措辞高度模板化，
# 规则的 precision 和 recall 都优于模型。实测 "I will file an A-to-Z claim" 的
# NEUTRAL 是 0.805，情绪上完全读不出威胁，靠的就是这一层。
# 右边是覆盖的措辞，本身就是字面量，不翻译。
THREAT_RULES = (
    ("a_to_z",          "A-to-Z claim"),
    ("chargeback",      "chargeback / charge back / charge-back"),
    ("dispute",         "file / open / raise a dispute · dispute the charge"),
    ("bbb",             "BBB / Better Business Bureau"),
    ("legal",           "lawyer / attorney / legal action / small claims / sue you"),
    ("fraud",           "scam* / fraud* / ripped me off"),
    ("negative_review", "leave / post / write a 1-star | negative | bad review"),
    ("report_seller",   "report you / this seller / this listing"),
)

# 反讽的三条判据，对应响应里的 sarcasm_kind。判据是「正向情绪词 + 负面事实」而不是
# 「正向情绪 + 负面情绪」——反讽文本里根本不含负面情绪词，后者完全失效。
SARCASM_KINDS = (
    {"kind": "idiom",                "example": "Thanks for nothing."},
    {"kind": "intra_sentence",       "example": "Great, another week without my order."},
    {"kind": "bare_praise_adjacent", "example": "Wonderful. The replacement arrived broken too."},
)

# 前置管线。detail 是字面模式，说明文案在前端 i18n（emo_pre_<step>）。
PREPROCESSING_STEPS = (
    {"step": "quote",     "detail": "> · On … wrote: · --- Original Message ---"},
    {"step": "signature", "detail": "\\n--\\n · Sent from my …"},
    {"step": "noise",     "detail": "order numbers · URLs · emails"},
    {"step": "allcaps",   "detail": "caps ratio > 85% and length ≥ 8"},
)

# 门控：两个门都直接返回 AMBIGUOUS，不进模型。这类响应的 l2 全零、l3_raw 为空、
# n_sentences=0——不是"模型判不出来"，是压根没跑模型，靠 ambiguous_reason 区分。
GATES = (
    {"gate": "content",  "reason": "insufficient_content",
     "detail": "alphabetic words < 2"},
    {"gate": "language", "reason": "unsupported_language",
     "detail": "non-English accents, or ≥ 2 non-English function words"},
)

# 28 个原始标签在客服场景下的先验频次。低频那一档要么折叠进簇要么丢弃，
# 单独拿来做决策没有统计意义。
LABEL_PRIORS = {
    "high": ("annoyance", "disappointment", "confusion", "curiosity", "gratitude",
             "neutral", "disapproval", "anger", "desire", "approval"),
    "mid":  ("fear", "nervousness", "sadness", "realization", "relief", "surprise",
             "disgust", "joy", "admiration", "optimism", "excitement"),
    "low":  ("amusement", "caring", "embarrassment", "grief", "love", "pride", "remorse"),
}

# GoEmotions 原论文里 support 少、F1 偏低的标签。只允许参与簇内聚合，
# 不允许单独用它们做决策。
LOW_SUPPORT_LABELS = ("grief", "pride", "relief", "nervousness")

# 每个簇的典型客户原话。是真实的英文买家措辞，属于语料不是文案，不翻译。
CLUSTER_EXAMPLES = {
    "HOSTILE":    "This is absolutely unacceptable",
    "FRUSTRATED": "Still hasn't arrived, disappointed",
    "ANXIOUS":    "Worried I've been scammed",
    "CONFUSED":   "Which size should I order?",
    "DEMANDING":  "I want a full refund",
    "NEUTRAL":    "Order #123-456, please advise",
    "GRATEFUL":   "Thanks, received it today",
    "SATISFIED":  "Love it, works great",
    "SELF_BLAME": "Sorry, I ordered the wrong one",
}


# ---------------------------------------------------------------------------
# 示例语料：情绪模型测试台的"一键填入"用例
# ---------------------------------------------------------------------------
# expect 是**人读下来应该是什么**，不是模型实际输出什么。两者不一致的用例是故意
# 留着的——测试台的价值就在于让人看见模型在哪儿会翻车，把示例改成模型稳过的句子
# 等于把体温计调到 36.5 度。已知会不一致的三条：
#
#   demanding_refund   DEMANDING 0.551 / FRUSTRATED 0.550，落在并列带里取了更负的
#   sarcasm_great_job  反讽没识别出来，判成 SATISFIED 0.945（sarcasm_override=False）
#   spanish_broken     西班牙语不在模型覆盖范围内，服务返回 AMBIGUOUS
SAMPLES = (
    {"id": "hostile_lawyer", "expect": "hostile",
     "text": "This is absolutely unacceptable. You people are thieves and I am calling my lawyer."},
    {"id": "frustrated_third", "expect": "frustrated",
     "text": "Where is my order?? Third email! I ordered a jacket two weeks ago and it still has "
             "not shipped. Nobody answers."},
    {"id": "anxious_trip", "expect": "anxious",
     "text": "I am worried my package will not arrive before my trip on Friday. Please tell me it is coming."},
    {"id": "confused_sizing", "expect": "confused",
     "text": "Could you tell me what size the medium is? I usually wear a medium in US sizing."},
    {"id": "demanding_refund", "expect": "demanding",
     "text": "I want a full refund today. Not store credit, not a replacement. A refund."},
    {"id": "neutral_tracking", "expect": "neutral",
     "text": "Please confirm the tracking number for order 12345."},
    {"id": "grateful_thanks", "expect": "grateful",
     "text": "Thank you so much for the quick help, you guys are great!"},
    {"id": "satisfied_love", "expect": "satisfied",
     "text": "The jacket arrived early and it is beautiful. Best purchase I have made this year."},
    {"id": "self_blame_order", "expect": "self_blame",
     "text": "Sorry, I think I ordered the wrong colour by mistake. My fault entirely."},
    {"id": "sarcasm_great_job", "expect": "hostile",
     "text": "Great job losing my package again. Truly world class service."},
    {"id": "allcaps_waiting", "expect": "frustrated",
     "text": "WHERE IS MY ORDER!!! I HAVE BEEN WAITING FOR THREE WEEKS!!!"},
    {"id": "spanish_broken", "expect": "frustrated",
     "text": "Mi pedido llegó roto y nadie me responde. Estoy muy molesto."},
)

SAMPLE_IDS = tuple(s["id"] for s in SAMPLES)


def taxonomy() -> dict[str, Any]:
    """情绪模型能识别的全部标签，给前端的"可识别标签"面板用。

    这是模型的能力说明书：9 个簇分别由哪些 GoEmotions 原始标签组成、极性是多少、
    算不算负面。前端不复写这份定义，改簇只改这个文件。
    """
    return {
        "clusters": [
            {
                "cluster": name,
                "sentiment": name.lower(),
                "labels": list(labels),
                "polarity": POLARITY.get(name),
                "negative": name in NEGATIVE_CLUSTERS,
                "positive": name in POSITIVE_CLUSTERS,
                "pooling": POOLING.get(name, "max"),
                "example": CLUSTER_EXAMPLES.get(name),
                # 簇里有多少个标签是 GoEmotions 上 support 少的：这个簇的分数
                # 有多少是靠没学好的标签撑着，看这个数
                "low_support": [l for l in labels if l in LOW_SUPPORT_LABELS],
            }
            for name, labels in CLUSTERS.items()
        ],
        "unmapped_labels": list(UNMAPPED_LABELS),
        "label_map": label_map(),
        "label_priors": {tier: list(labels) for tier, labels in LABEL_PRIORS.items()},
        "low_support_labels": list(LOW_SUPPORT_LABELS),
        "l1_levels": list(L1_LEVELS),
        "escalation_l1": ESCALATION_L1,
        "ambiguous_l1": AMBIGUOUS_L1,
        "tie_band": TIE_BAND,
        "label_count": sum(len(v) for v in CLUSTERS.values()) + len(UNMAPPED_LABELS),
    }


def label_map() -> list[dict[str, Any]]:
    """28 个 GoEmotions 原始标签各自落到哪个簇，按标签名排序。

    taxonomy() 里的 clusters 是"簇 -> 标签"，这里是反过来的"标签 -> 簇"：说明书
    页面上真正会被查的问题是"模型输出的 realization 算什么"，按簇排列答不了。
    没归簇的标签（caring）cluster 给 None，这一行本身就是要展示的信息。
    """
    rows = [
        {"label": label, "cluster": cluster, "sentiment": cluster.lower()}
        for cluster, labels in CLUSTERS.items()
        for label in labels
    ]
    rows += [{"label": label, "cluster": None, "sentiment": None} for label in UNMAPPED_LABELS]
    return sorted(rows, key=lambda r: r["label"])


def aggregator() -> dict[str, Any]:
    """服务端聚合层的规格，给说明书页面的"分层与路由"那一页用。

    这里描述的是**服务端**怎么把 28 维概率变成一个处置等级，不是我们这边的逻辑。
    我们这边只消费两个结果：L2 的 argmax 进 sentiment，L1 进人工复核规则。
    """
    return {
        "layers": [dict(l) for l in LAYERS],
        "l1_actions": {k: dict(v) for k, v in L1_ACTIONS.items()},
        "escalation": {
            "weights": dict(ESCALATION["weights"]),
            "modifiers": dict(ESCALATION["modifiers"]),
            "demanding_trigger": ESCALATION["demanding_trigger"],
            "bands": [list(b) for b in ESCALATION["bands"]],
            "p3_gate": dict(ESCALATION["p3_gate"]),
            "fallback": dict(ESCALATION["fallback"]),
        },
        "threat_rules": [{"rule": r, "covers": c} for r, c in THREAT_RULES],
        "sarcasm_kinds": [dict(s) for s in SARCASM_KINDS],
        "preprocessing": [dict(s) for s in PREPROCESSING_STEPS],
        "gates": [dict(g) for g in GATES],
    }


def model_card() -> dict[str, Any]:
    """模型档案的副本。给出去的是副本，免得调用方改到模块级常量。"""
    card = dict(MODEL_CARD)
    card["metrics"] = [dict(m) for m in MODEL_CARD["metrics"]]
    card["best_label"] = dict(MODEL_CARD["best_label"])
    card["worst_labels"] = list(MODEL_CARD["worst_labels"])
    return card


def config() -> dict[str, Any]:
    url = (os.getenv("EMOTION_API_URL") or "").strip().strip('"').strip("'")
    return {
        "url": url,
        "enabled": bool(url),
        "timeout": float(os.getenv("EMOTION_TIMEOUT") or 10),
    }


def _score(value: Any) -> float | None:
    """把服务返回的一个分数合法化：非数字/NaN/Inf 一律丢弃，其余截断到 [0, 1]。"""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return round(min(max(f, 0.0), 1.0), 4)


def _signed(value: Any) -> float | None:
    """negativity 这类可以为负的分数：范围 [-1, 1]，同样丢弃 NaN/Inf。"""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return round(min(max(f, -1.0), 1.0), 4)


def cluster_scores(payload: dict[str, Any]) -> dict[str, float]:
    """从响应里取 9 个簇的分数。

    正常路径是直接读 l2；只有当服务没给 l2（老版本或部分失败）时，才用 l3_raw
    按 CLUSTERS 聚合兜底——簇内取 max，因为 l3_raw 是多标签打分，簇内标签是
    "或"的关系（anger 高或 disgust 高都算 HOSTILE）。注意跨句池化已经在服务端
    做完了，这里的聚合只是标签 -> 簇这一层。
    """
    l2 = payload.get("l2")
    if isinstance(l2, dict):
        scores = {c: _score(l2.get(c)) for c in CLUSTER_NAMES}
        scores = {c: s for c, s in scores.items() if s is not None}
        if scores:
            return scores

    raw = payload.get("l3_raw")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, float] = {}
    for cluster, labels in CLUSTERS.items():
        vals = [s for s in (_score(raw.get(l)) for l in labels) if s is not None]
        if vals:
            out[cluster] = max(vals)
    return out


def top_cluster(scores: dict[str, float]) -> tuple[str, float] | None:
    """取分最高的簇；最高分下方 TIE_BAND 之内的都算并列，并列里取极性最负的那个。

    这个不对称是故意的：把并列判成负面，顶多多走一次人工复核；判成正面，则会把一个
    愤怒客户放进全自动回复流程。返回的分数是被选中那个簇自己的分数，不是最高分。
    """
    if not scores:
        return None
    best = max(scores.values())
    tied = [c for c, s in scores.items() if s >= best - TIE_BAND]
    cluster = min(tied, key=lambda c: (POLARITY.get(c, 0.0), -scores[c], c))
    return cluster, scores[cluster]


def _str_list(value: Any, max_items: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v)[:80] for v in value[:max_items] if v]


def parse_response(payload: Any) -> dict[str, Any]:
    """把服务响应整理成写进 tags 的记录。字段缺失一律降级为 None/默认值，
    绝不猜测——情绪是辅助信号，宁可少一个字段也不要编一个。
    """
    if not isinstance(payload, dict):
        raise EmotionError(f"Unexpected response shape: {str(payload)[:200]}")

    scores = cluster_scores(payload)
    # 服务自己说读不了（AMBIGUOUS），或者所有簇都是 0 分——两种情况都不是"中性"，
    # 是"没有判断"，不能拿去 argmax（全 0 并列会取到极性最负的 HOSTILE）。
    if payload.get("l1") == AMBIGUOUS_L1 or max(scores.values(), default=0.0) <= 0.0:
        reason = str(payload.get("ambiguous_reason") or "").strip() or "all cluster scores are zero"
        raise EmotionError(f"Model returned no usable emotion ({reason}).")

    top = top_cluster(scores)
    if top is None:
        raise EmotionError(f"Response carried no usable cluster scores: {str(payload)[:200]}")
    cluster, score = top

    flags = payload.get("flags")
    return {
        "sentiment": cluster.lower(),      # 进 tags["sentiment"] 的值
        "cluster": cluster,                # 服务端原始大写簇名，便于对着服务日志排查
        "score": score,
        "polarity": POLARITY.get(cluster),
        "l1": payload.get("l1") if payload.get("l1") in L1_LEVELS else None,
        "escalation_score": _score(payload.get("escalation_score")),
        "negativity": _signed(payload.get("negativity")),
        "l2": scores,
        "rule_hits": _str_list(payload.get("rule_hits")),
        "sarcasm_override": bool(payload.get("sarcasm_override")),
        "sarcasm_kind": str(payload.get("sarcasm_kind") or "")[:40] or None,
        "flags": {k: bool(v) for k, v in flags.items()} if isinstance(flags, dict) else {},
        "n_sentences": payload.get("n_sentences") if isinstance(payload.get("n_sentences"), int) else None,
        "ambiguous_reason": str(payload.get("ambiguous_reason") or "")[:200] or None,
    }


async def classify(text: str) -> dict[str, Any]:
    """对一封邮件做情绪识别。失败时抛 EmotionError，由调用方决定怎么兜底。

    不做截断：长邮件里的引用历史和签名档由服务端的 preprocessing 负责剥离，
    在客户端切一刀反而可能把正文末尾真正生气的那两句切掉。
    """
    cfg = config()
    if not cfg["enabled"]:
        raise EmotionError(
            "No emotion endpoint configured. Set EMOTION_API_URL in the .env file next to server.py."
        )
    if not (text or "").strip():
        raise EmotionError("Empty text.")

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=cfg["timeout"]) as client:
            resp = await client.post(cfg["url"], json={"text": text})
    except httpx.HTTPError as exc:
        raise EmotionError(f"{type(exc).__name__}: {exc}"[:300]) from exc

    if resp.status_code >= 400:
        raise EmotionError(f"Emotion API returned {resp.status_code}: {resp.text[:300]}")
    try:
        payload = resp.json()
    except ValueError as exc:
        raise EmotionError(f"Emotion API returned non-JSON: {resp.text[:300]}") from exc

    record = parse_response(payload)
    record["latency_ms"] = int((time.perf_counter() - started) * 1000)
    return record


# ---------------------------------------------------------------------------
# 冒烟测试辅助函数：手工跑用例集时用，不参与线上链路
# ---------------------------------------------------------------------------

def call(endpoint, text, timeout):
    """发一次请求,返回 (status, body)。body 解析失败时原样给字符串"""
    req = urllib.request.Request(
        endpoint,
        data=json.dumps({"text": text}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        # 4xx/5xx 的响应体必须读出来,否则 422 只能看到一句 "HTTP Error 422"
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def check(case, status, resp):
    """返回 (hard_fails, soft_fails)

    硬断言由规则层和路由代码决定,给定分数就是确定的;
    软断言依赖模型打分,单条失败不阻塞,整体超预算才阻塞。
    """
    hard, soft = [], []

    expect_status = case.get("expect_status", 200)
    if status != expect_status:
        hard.append(f"http status: expected {expect_status}, got {status} — {resp}")
        return hard, soft
    if expect_status != 200:
        # 预期就是错误响应,没有 body 契约可查
        return hard, soft

    l2 = resp.get("l2") or {}

    if "expect_l1" in case and resp.get("l1") != case["expect_l1"]:
        hard.append(f"l1: expected {case['expect_l1']}, got {resp.get('l1')}")

    if "expect_rule_hit" in case:
        hit = bool(resp.get("rule_hits"))
        if hit != case["expect_rule_hit"]:
            hard.append(f"rule_hits: expected {case['expect_rule_hit']}, "
                        f"got {hit} {resp.get('rule_hits')}")

    if "expect_sarcasm_override" in case:
        got = resp.get("sarcasm_override", False)
        if got != case["expect_sarcasm_override"]:
            hard.append(f"sarcasm_override: expected {case['expect_sarcasm_override']}, got {got}")

    if "expect_top_l2" in case:
        if not l2:
            soft.append("top_l2: 响应里没有 l2")
        else:
            best = max(l2.values())
            # 并列不能算通过,否则 dict 顺序决定成败
            tops = sorted(c for c, s in l2.items() if s == best)
            if tops != [case["expect_top_l2"]]:
                soft.append(f"top_l2: expected {case['expect_top_l2']}, "
                            f"got {'/'.join(tops)} @ {best:.3f}")

    for cluster, floor in case.get("expect_min", {}).items():
        got = l2.get(cluster, 0.0)
        if got < floor:
            soft.append(f"{cluster}: expected >= {floor}, got {got:.3f}")

    # 用 >= 判定:服务端 score >= THRESHOLDS[c] 即触发,expect_max 的语义是"不许触发"
    for cluster, ceil in case.get("expect_max", {}).items():
        got = l2.get(cluster, 0.0)
        if got >= ceil:
            soft.append(f"{cluster}: expected < {ceil}(不得触发), got {got:.3f}")

    return hard, soft
