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
    "reply_source": "TEXT",  # 'ai' | 'manual' — who actually wrote reply_body
}


def init() -> None:
    with _lock, _connect() as conn:
        conn.executescript(SCHEMA)
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(threads)")}
        for column, decl in _ADDED_COLUMNS.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE threads ADD COLUMN {column} {decl}")


def user_id_for_ip(ip: str) -> str:
    """Stable pseudonymous handle for an IP. The raw IP is stored separately."""
    digest = hashlib.sha256(f"helios::{ip}".encode()).hexdigest()
    return f"user-{digest[:8]}"


def create_thread(**kw: Any) -> int:
    cols = (
        "user_id", "ip", "scenario_id", "scenario_title", "context_json", "policy_json",
        "tags_json", "in_subject", "in_body", "in_language", "status", "created_at",
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


def stats() -> dict[str, Any]:
    with _lock, _connect() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM threads").fetchone()["c"]
        users = conn.execute("SELECT COUNT(DISTINCT user_id) c FROM threads").fetchone()["c"]
    return {"threads": total, "users": users, "server_time": time.time()}
