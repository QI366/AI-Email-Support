"""SQLite persistence. One row per thread (customer email + AI reply)."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
from typing import Any

DB_PATH = os.getenv("MAIL_DB_PATH", os.path.join(os.path.dirname(__file__), "data", "mailbox.db"))
_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS threads (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           TEXT    NOT NULL,
    ip                TEXT    NOT NULL,
    scenario_id       TEXT    NOT NULL,
    scenario_title    TEXT    NOT NULL,
    context_json      TEXT    NOT NULL,
    policy_json       TEXT    NOT NULL,
    tags_json         TEXT,
    in_subject        TEXT    NOT NULL,
    in_body           TEXT    NOT NULL,
    in_language       TEXT    NOT NULL,
    reply_subject     TEXT,
    reply_body        TEXT,
    reply_language    TEXT,
    status            TEXT    NOT NULL,
    error             TEXT,
    model             TEXT,
    latency_ms        INTEGER,
    created_at        REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_threads_created ON threads(id DESC);

-- 情绪模型测试台：一行 = 一次"拿一段文本喂给本地情绪模型"的记录 + 人给的反馈。
-- 和 threads 完全分开：这里测的是模型本身，不是某封客户来信的回复流程。
-- 反馈字段可以为空（测了还没评价），也可以被另一个人改写——记录里存 feedback_by，
-- 谁改的看得见。
CREATE TABLE IF NOT EXISTS emotion_tests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL,
    ip            TEXT    NOT NULL,
    text          TEXT    NOT NULL,
    sample_id     TEXT,              -- 来自哪条内置示例，自由输入为 NULL
    result_json   TEXT,              -- emotion.classify() 的完整记录
    sentiment     TEXT,              -- 冗余一份，聚合时不用解 JSON
    score         REAL,
    l1            TEXT,
    latency_ms    INTEGER,
    error         TEXT,              -- 识别失败时的原因（不支持的语言、服务不可用…）
    verdict       TEXT,              -- 'correct' | 'wrong' | NULL(还没人评价)
    true_labels   TEXT,              -- JSON 数组：评价者认为的真实簇，可多选
    note          TEXT,
    feedback_by   TEXT,
    feedback_at   REAL,
    created_at    REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emotests_created ON emotion_tests(id DESC);
CREATE INDEX IF NOT EXISTS idx_emotests_user ON emotion_tests(user_id, id DESC);

-- 翻译模型测试台：一行 = 一次"拿一段文字喂给本地翻译模型"的记录 + 人给的反馈。
-- 和 emotion_tests 同构，但评价分两轴，因为这条链路有两个独立的产出：
--   verdict    译文本身好不好（good/bad）
--   true_lang  这段文字实际是什么语种——语种判错和译文翻错是两回事，一封俄语信
--              可以译文完全正确而语种报成 en（见 translation.KNOWN_BEHAVIOURS）
--   suggested_translation  评价者认为更准确的译文（可选）
-- 两轴都可以只填一个：只想说"语种判错了"不必对译文质量表态，反之亦然。
CREATE TABLE IF NOT EXISTS translation_tests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL,
    ip            TEXT    NOT NULL,
    text          TEXT    NOT NULL,
    sample_id     TEXT,              -- 来自哪条内置用例，自由输入为 NULL
    result_json   TEXT,              -- translation.inspect() 的完整记录（含分片明细）
    source_lang   TEXT,              -- 仲裁之后真正会写进标签的语种，冗余一份便于聚合
    raw_lang      TEXT,              -- 服务端原样报的语种，可能不在我们开放的 9 种里
    local_lang    TEXT,              -- 本地正则的兜底判断，用来和服务端对照
    char_count    INTEGER,
    latency_ms    INTEGER,
    error         TEXT,              -- 调用失败的原因（服务不可用、译文为空…）
    verdict       TEXT,              -- 'good' | 'bad' | NULL(没对译文表态)
    true_lang     TEXT,              -- 评价者认为的真实语种，NULL 表示没对语种表态
    suggested_translation TEXT,
    note          TEXT,
    feedback_by   TEXT,
    feedback_at   REAL,
    created_at    REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txtests_created ON translation_tests(id DESC);
CREATE INDEX IF NOT EXISTS idx_txtests_user ON translation_tests(user_id, id DESC);
"""


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=8000")
    return conn


# Columns added after the first release. CREATE TABLE IF NOT EXISTS leaves an
# existing table alone, so they have to be patched in explicitly.
_ADDED_COLUMNS = {
    "tags_json": "TEXT",
    "reply_source": "TEXT",       # 'ai' | 'manual' — who actually wrote reply_body
    # translation.to_english() 的完整记录：英文基准文本、原文语种、语种是谁判的、
    # 有没有真的调翻译服务、失败原因。老数据这一列是 NULL，界面按"没有译文"处理。
    "translation_json": "TEXT",
}

_ADDED_TX_COLUMNS = {
    "suggested_translation": "TEXT",
}


def init() -> None:
    with _lock, _connect() as conn:
        conn.executescript(SCHEMA)
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(threads)")}
        for column, decl in _ADDED_COLUMNS.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE threads ADD COLUMN {column} {decl}")
        existing_tx = {row["name"] for row in conn.execute("PRAGMA table_info(translation_tests)")}
        for column, decl in _ADDED_TX_COLUMNS.items():
            if column not in existing_tx:
                conn.execute(f"ALTER TABLE translation_tests ADD COLUMN {column} {decl}")
        _warn_if_corrupt(conn)


def _warn_if_corrupt(conn: sqlite3.Connection) -> None:
    """坏页不会挡住启动——建表、写入都照常，直到某个请求正好扫到它才炸。
    启动时先敲一下，让"库坏了"在服务起来的那一刻就写在日志里，而不是等用户
    点开列表看到 500。只报警不拦启动：库坏了也还有一大半数据能读。"""
    try:
        # row_factory 是 sqlite3.Row，取出来的不是 tuple，只能按下标读第一列。
        report = [str(row[0]) for row in conn.execute("PRAGMA quick_check")]
    except sqlite3.DatabaseError as exc:
        report = [str(exc)]
    if report == ["ok"]:
        return
    detail = "; ".join(report[:3])
    print(f"[store] 数据库自检没过：{detail}")
    print(f"[store] 停掉服务后跑 python repair_db.py 重建（原库会留一份备份）：{DB_PATH}")


def user_id_for_ip(ip: str) -> str:
    """Stable pseudonymous handle for an IP. The raw IP is stored separately."""
    digest = hashlib.sha256(f"helios::{ip}".encode()).hexdigest()
    return f"user-{digest[:8]}"


def create_thread(**kw: Any) -> int:
    cols = (
        "user_id", "ip", "scenario_id", "scenario_title", "context_json", "policy_json",
        "tags_json", "translation_json", "in_subject", "in_body", "in_language",
        "status", "created_at",
    )
    values = [kw[c] for c in cols]
    with _lock, _connect() as conn:
        cur = conn.execute(
            f"INSERT INTO threads ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            values,
        )
        return int(cur.lastrowid)


def finish_thread(
    thread_id: int,
    *,
    status: str,
    reply_subject: str | None = None,
    reply_body: str | None = None,
    reply_language: str | None = None,
    model: str | None = None,
    latency_ms: int | None = None,
    error: str | None = None,
) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            """UPDATE threads SET status=?, reply_subject=?, reply_body=?, reply_language=?,
                   model=?, latency_ms=?, error=?, reply_source='ai' WHERE id=?""",
            (status, reply_subject, reply_body, reply_language, model, latency_ms, error, thread_id),
        )


def set_manual_reply(thread_id: int, *, reply_subject: str, reply_body: str, reply_language: str) -> None:
    """A human agent's reply overrides whatever Step 2 produced (or failed to
    produce). Always lands the thread in 'replied', even one Step 2 marked
    'failed' — that is the whole point of the manual escape hatch.
    """
    with _lock, _connect() as conn:
        conn.execute(
            """UPDATE threads SET status='replied', reply_subject=?, reply_body=?,
                   reply_language=?, reply_source='manual', error=NULL WHERE id=?""",
            (reply_subject, reply_body, reply_language, thread_id),
        )


def _compact_tags(tags: dict[str, Any] | None) -> dict[str, Any] | None:
    """Just enough for a list-row chip; the full record rides on the detail call."""
    if not tags:
        return None
    slim = {k: tags[k] for k in ("intent", "sentiment", "urgency") if tags.get(k)}
    return slim or None


def _row_to_dict(row: sqlite3.Row, *, full: bool) -> dict[str, Any]:
    body = row["in_body"] or ""
    tags = json.loads(row["tags_json"]) if row["tags_json"] else None
    out: dict[str, Any] = {
        "id": row["id"],
        "user_id": row["user_id"],
        "scenario_id": row["scenario_id"],
        "scenario_title": row["scenario_title"],
        "subject": row["in_subject"],
        "in_language": row["in_language"],
        "reply_subject": row["reply_subject"],
        "reply_language": row["reply_language"],
        "status": row["status"],
        "model": row["model"],
        "latency_ms": row["latency_ms"],
        "created_at": row["created_at"],
        "preview": (body[:140] + "…") if len(body) > 140 else body,
        "tags": tags if full else _compact_tags(tags),
        "reply_source": row["reply_source"] or "ai",
    }
    if full:
        out["body"] = body
        out["reply_body"] = row["reply_body"]
        out["error"] = row["error"]
        out["context"] = json.loads(row["context_json"])
        out["policy"] = json.loads(row["policy_json"])
        # 英文基准文本只挂在详情上：列表行用不到译文，每行多带一份正文纯属浪费
        out["translation"] = json.loads(row["translation_json"]) if row["translation_json"] else None
    return out


def list_threads(user_id: str | None = None, limit: int = 60, offset: int = 0) -> list[dict[str, Any]]:
    sql = "SELECT * FROM threads"
    args: list[Any] = []
    if user_id:
        sql += " WHERE user_id = ?"
        args.append(user_id)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    with _lock, _connect() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [_row_to_dict(r, full=False) for r in rows]


def get_thread(thread_id: int) -> dict[str, Any] | None:
    with _lock, _connect() as conn:
        row = conn.execute("SELECT * FROM threads WHERE id = ?", (thread_id,)).fetchone()
    return _row_to_dict(row, full=True) if row else None


def tag_stats(user_id: str | None = None) -> dict[str, Any]:
    """Aggregate the step-1 tags across every stored thread.

    Counts come from the whole table rather than the page the UI has loaded, so
    the analytics view does not silently describe only the most recent 200.
    """
    sql = "SELECT tags_json FROM threads"
    args: list[Any] = []
    if user_id:
        sql += " WHERE user_id = ?"
        args.append(user_id)
    with _lock, _connect() as conn:
        rows = conn.execute(sql, args).fetchall()

    dists: dict[str, dict[str, int]] = {k: {} for k in ("intent", "sentiment", "urgency", "language")}
    cross: dict[str, dict[str, int]] = {}   # intent x urgency: which topics carry the pressure
    total = len(rows)
    classified = failed = unanalysed = 0
    low_confidence = 0          # the analyser's own "I am unsure" band, per the template
    conf_sum = conf_n = 0.0
    ms_sum = ms_n = 0

    for row in rows:
        raw = row["tags_json"]
        tags = json.loads(raw) if raw else None
        if not tags:
            unanalysed += 1
            continue
        if isinstance(tags.get("analysis_ms"), int):
            ms_sum += tags["analysis_ms"]
            ms_n += 1
        if not tags.get("intent"):
            failed += 1
            continue

        classified += 1
        for field in dists:
            value = tags.get(field)
            if value:
                dists[field][value] = dists[field].get(value, 0) + 1
        if tags.get("urgency"):
            row = cross.setdefault(tags["intent"], {})
            row[tags["urgency"]] = row.get(tags["urgency"], 0) + 1
        conf = tags.get("intent_confidence")
        if isinstance(conf, (int, float)):
            conf_sum += conf
            conf_n += 1
            # The template tells the model to drop below 0.7 when the message is
            # vague, so this rate reads as "how much mail was hard to classify".
            if conf < 0.7:
                low_confidence += 1

    return {
        "total": total,
        "classified": classified,
        "failed": failed,
        "unanalysed": unanalysed,
        "low_confidence": low_confidence,
        "avg_intent_confidence": round(conf_sum / conf_n, 3) if conf_n else None,
        "avg_analysis_ms": round(ms_sum / ms_n) if ms_n else None,
        "distributions": {k: v for k, v in dists.items()},
        "intent_by_urgency": cross,
    }


# ---------------------------------------------------------------------------
# 情绪模型测试台
# ---------------------------------------------------------------------------

_EMO_VERDICTS = ("correct", "wrong")


def create_emotion_test(**kw: Any) -> int:
    cols = ("user_id", "ip", "text", "sample_id", "result_json", "sentiment",
            "score", "l1", "latency_ms", "error", "created_at")
    with _lock, _connect() as conn:
        cur = conn.execute(
            f"INSERT INTO emotion_tests ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            [kw.get(c) for c in cols],
        )
        return int(cur.lastrowid)


def set_emotion_feedback(
    test_id: int,
    *,
    verdict: str | None,
    true_labels: list[str],
    note: str | None,
    user_id: str,
) -> bool:
    """给一条测试记录写反馈。返回 False 表示这条记录不存在。

    谁都能评价谁的测试——这是一块公共的模型体检板，不是私人笔记。后写的覆盖先写的，
    但 feedback_by 会记下最后动手的人，翻记录时看得见是谁的判断。
    """
    with _lock, _connect() as conn:
        row = conn.execute("SELECT id FROM emotion_tests WHERE id = ?", (test_id,)).fetchone()
        if row is None:
            return False
        conn.execute(
            """UPDATE emotion_tests SET verdict=?, true_labels=?, note=?, feedback_by=?, feedback_at=?
               WHERE id=?""",
            (
                verdict if verdict in _EMO_VERDICTS else None,
                json.dumps(true_labels, ensure_ascii=False) if true_labels else None,
                note or None,
                user_id,
                time.time(),
                test_id,
            ),
        )
    return True


def _emotion_row(row: sqlite3.Row, *, full: bool) -> dict[str, Any]:
    text = row["text"] or ""
    out: dict[str, Any] = {
        "id": row["id"],
        "user_id": row["user_id"],
        "sample_id": row["sample_id"],
        "text": text if full else ((text[:160] + "…") if len(text) > 160 else text),
        "sentiment": row["sentiment"],
        "score": row["score"],
        "l1": row["l1"],
        "latency_ms": row["latency_ms"],
        "error": row["error"],
        "verdict": row["verdict"],
        "true_labels": json.loads(row["true_labels"]) if row["true_labels"] else [],
        "note": row["note"],
        "feedback_by": row["feedback_by"],
        "feedback_at": row["feedback_at"],
        "created_at": row["created_at"],
    }
    if full:
        out["result"] = json.loads(row["result_json"]) if row["result_json"] else None
    return out


def get_emotion_test(test_id: int) -> dict[str, Any] | None:
    with _lock, _connect() as conn:
        row = conn.execute("SELECT * FROM emotion_tests WHERE id = ?", (test_id,)).fetchone()
    return _emotion_row(row, full=True) if row else None


def list_emotion_tests(user_id: str | None = None, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    sql = "SELECT * FROM emotion_tests"
    args: list[Any] = []
    if user_id:
        sql += " WHERE user_id = ?"
        args.append(user_id)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    with _lock, _connect() as conn:
        rows = conn.execute(sql, args).fetchall()
    # 列表里也带上完整 result：结果卡要画 9 个簇的分数条，再为每行发一次详情请求不值当
    return [{**_emotion_row(r, full=True)} for r in rows]


def emotion_test_stats(user_id: str | None = None) -> dict[str, Any]:
    """测试台的聚合口径。

    判对率的分母是**已反馈**的条数，不是测试总数——没人评价的记录既不算对也不算错，
    混进分母只会让准确率随着"测了没评"的数量凭空下降。
    """
    sql = "SELECT * FROM emotion_tests"
    args: list[Any] = []
    if user_id:
        sql += " WHERE user_id = ?"
        args.append(user_id)
    with _lock, _connect() as conn:
        rows = conn.execute(sql, args).fetchall()

    predicted: dict[str, int] = {}       # 模型判成了什么
    truth: dict[str, int] = {}           # 人认为真实是什么
    confusion: dict[str, dict[str, int]] = {}   # 预测 -> 真实标签
    per_cluster: dict[str, dict[str, int]] = {}  # 每个簇各自的对/错
    total = len(rows)
    failed = reviewed = correct = 0
    ms_sum = ms_n = 0
    testers: set[str] = set()

    def bump(predicted_cluster: str, true_cluster: str) -> None:
        truth[true_cluster] = truth.get(true_cluster, 0) + 1
        cell = confusion.setdefault(predicted_cluster, {})
        cell[true_cluster] = cell.get(true_cluster, 0) + 1

    for row in rows:
        testers.add(row["user_id"])
        if isinstance(row["latency_ms"], int):
            ms_sum += row["latency_ms"]
            ms_n += 1
        if row["error"]:
            failed += 1
            continue

        s = row["sentiment"]
        if s:
            predicted[s] = predicted.get(s, 0) + 1

        verdict = row["verdict"]
        if verdict not in _EMO_VERDICTS:
            continue
        reviewed += 1
        bucket = per_cluster.setdefault(s or "—", {"correct": 0, "wrong": 0})
        if verdict == "correct":
            correct += 1
            bucket["correct"] += 1
            # 判对时人没必要再选标签，真实标签就是模型给的那个
            if s:
                bump(s, s)
        else:
            bucket["wrong"] += 1
            for label in (json.loads(row["true_labels"]) if row["true_labels"] else []):
                if s:
                    bump(s, label)

    return {
        "total": total,
        "failed": failed,
        "reviewed": reviewed,
        "correct": correct,
        "accuracy": round(correct / reviewed, 3) if reviewed else None,
        "avg_latency_ms": round(ms_sum / ms_n) if ms_n else None,
        "testers": len(testers),
        "predicted": predicted,
        "truth": truth,
        "confusion": confusion,
        "per_cluster": per_cluster,
    }


# ---------------------------------------------------------------------------
# 翻译模型测试台
# ---------------------------------------------------------------------------

_TX_VERDICTS = ("good", "bad")


def create_translation_test(**kw: Any) -> int:
    cols = ("user_id", "ip", "text", "sample_id", "result_json", "source_lang", "raw_lang",
            "local_lang", "char_count", "latency_ms", "error", "created_at")
    with _lock, _connect() as conn:
        cur = conn.execute(
            f"INSERT INTO translation_tests ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            [kw.get(c) for c in cols],
        )
        return int(cur.lastrowid)


def set_translation_feedback(
    test_id: int,
    *,
    verdict: str | None,
    true_lang: str | None,
    suggested_translation: str | None,
    note: str | None,
    user_id: str,
) -> bool:
    """给一条翻译测试写反馈。返回 False 表示这条记录不存在。

    和情绪测试台同一个口径：谁都能评价谁的测试，后写的覆盖先写的，feedback_by 记下
    最后动手的人。两轴各自可以为空——只指出语种判错、不对译文质量表态是完全合理的
    一条反馈。
    """
    with _lock, _connect() as conn:
        row = conn.execute("SELECT id FROM translation_tests WHERE id = ?", (test_id,)).fetchone()
        if row is None:
            return False
        conn.execute(
            """UPDATE translation_tests SET verdict=?, true_lang=?, suggested_translation=?, note=?, feedback_by=?, feedback_at=?
               WHERE id=?""",
            (
                verdict if verdict in _TX_VERDICTS else None,
                true_lang or None,
                suggested_translation or None,
                note or None,
                user_id,
                time.time(),
                test_id,
            ),
        )
    return True


def _translation_row(row: sqlite3.Row, *, full: bool) -> dict[str, Any]:
    text = row["text"] or ""
    out: dict[str, Any] = {
        "id": row["id"],
        "user_id": row["user_id"],
        "sample_id": row["sample_id"],
        "text": text if full else ((text[:160] + "…") if len(text) > 160 else text),
        "source_lang": row["source_lang"],
        "raw_lang": row["raw_lang"],
        "local_lang": row["local_lang"],
        "char_count": row["char_count"],
        "latency_ms": row["latency_ms"],
        "error": row["error"],
        "verdict": row["verdict"],
        "true_lang": row["true_lang"],
        "suggested_translation": row["suggested_translation"],
        "note": row["note"],
        "feedback_by": row["feedback_by"],
        "feedback_at": row["feedback_at"],
        "created_at": row["created_at"],
    }
    if full:
        out["result"] = json.loads(row["result_json"]) if row["result_json"] else None
    return out


def get_translation_test(test_id: int) -> dict[str, Any] | None:
    with _lock, _connect() as conn:
        row = conn.execute("SELECT * FROM translation_tests WHERE id = ?", (test_id,)).fetchone()
    return _translation_row(row, full=True) if row else None


def list_translation_tests(user_id: str | None = None, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    sql = "SELECT * FROM translation_tests"
    args: list[Any] = []
    if user_id:
        sql += " WHERE user_id = ?"
        args.append(user_id)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    with _lock, _connect() as conn:
        rows = conn.execute(sql, args).fetchall()
    # 列表里也带上完整 result：结果卡要画逐片明细，再为每行发一次详情请求不值当
    return [_translation_row(r, full=True) for r in rows]


def translation_test_stats(user_id: str | None = None) -> dict[str, Any]:
    """测试台的聚合口径。两轴分别统计，分母各算各的。

    译文质量的分母是"对译文表过态"的条数，语种准确率的分母是"对语种表过态"的条数。
    合成一个总准确率会把两件不同的事平均掉：语种判错但译文正确的那类记录（俄语信
    就是）在两轴上的贡献方向是相反的。
    """
    sql = "SELECT * FROM translation_tests"
    args: list[Any] = []
    if user_id:
        sql += " WHERE user_id = ?"
        args.append(user_id)
    with _lock, _connect() as conn:
        rows = conn.execute(sql, args).fetchall()

    detected: dict[str, int] = {}                 # 链路判成了什么语种
    truth: dict[str, int] = {}                    # 人认为实际是什么语种
    confusion: dict[str, dict[str, int]] = {}     # 判定 -> 真实
    total = len(rows)
    failed = reviewed = good = 0
    lang_judged = lang_correct = 0
    ms_sum = ms_n = 0
    char_sum = 0
    latency_buckets = {"under_5s": 0, "under_15s": 0, "under_30s": 0, "over_30s": 0}
    testers: set[str] = set()

    for row in rows:
        testers.add(row["user_id"])
        if isinstance(row["latency_ms"], int):
            ms_sum += row["latency_ms"]
            ms_n += 1
            if isinstance(row["char_count"], int):
                char_sum += row["char_count"]
            latency = row["latency_ms"]
            if latency < 5000:
                latency_buckets["under_5s"] += 1
            elif latency < 15000:
                latency_buckets["under_15s"] += 1
            elif latency < 30000:
                latency_buckets["under_30s"] += 1
            else:
                latency_buckets["over_30s"] += 1
        if row["error"]:
            failed += 1
            continue

        lang = row["source_lang"]
        if lang:
            detected[lang] = detected.get(lang, 0) + 1

        if row["verdict"] in _TX_VERDICTS:
            reviewed += 1
            if row["verdict"] == "good":
                good += 1

        true_lang = row["true_lang"]
        if true_lang:
            lang_judged += 1
            truth[true_lang] = truth.get(true_lang, 0) + 1
            if lang:
                cell = confusion.setdefault(lang, {})
                cell[true_lang] = cell.get(true_lang, 0) + 1
            if true_lang == lang:
                lang_correct += 1

    return {
        "total": total,
        "failed": failed,
        "reviewed": reviewed,
        "good": good,
        "bad": reviewed - good,
        "quality": round(good / reviewed, 3) if reviewed else None,
        "lang_judged": lang_judged,
        "lang_correct": lang_correct,
        "lang_accuracy": round(lang_correct / lang_judged, 3) if lang_judged else None,
        "avg_latency_ms": round(ms_sum / ms_n) if ms_n else None,
        # 每秒多少字：耗时几乎只跟输出 token 数走，这个数只用来给"要等多久"一个量级
        "chars_per_s": round(char_sum / (ms_sum / 1000), 1) if ms_sum and char_sum else None,
        "testers": len(testers),
        "detected": detected,
        "truth": truth,
        "confusion": confusion,
        "latency_buckets": latency_buckets,
    }


def stats() -> dict[str, Any]:
    with _lock, _connect() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM threads").fetchone()["c"]
        users = conn.execute("SELECT COUNT(DISTINCT user_id) c FROM threads").fetchone()["c"]
    return {"threads": total, "users": users, "server_time": time.time()}
