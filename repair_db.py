"""Rebuild a corrupt mailbox.db by copying every row SQLite can still read.

"database disk image is malformed" 意味着某些页已经读不回来了，没有任何 PRAGMA
能把它们变出来。能做的只有：逐行扫过每张表，把还读得动的行搬进一个全新的库，
读不动的那几行如实报出来——它们是真的丢了。

    python repair_db.py              # 修 data/mailbox.db
    python repair_db.py 别的路径.db

原库会被改名成 <名字>.corrupt-<时间戳> 留在原地，不删。修好的库整体性检查过
才会顶上去；检查不过就原地不动，什么都不换。

跑之前必须先停掉服务：Windows 上文件被占着就换不了名，脚本会直接报错退出。
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import sys
import time

DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "mailbox.db")

# 内部表由 SQLite 自己维护，不能照抄 DDL；sqlite_sequence 的内容单独补。
_INTERNAL = ("sqlite_sequence", "sqlite_stat1", "sqlite_stat4")


def _tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return [r[0] for r in rows]


def _schema_sql(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return [r[0] for r in rows]


def _rowids(conn: sqlite3.Connection, table: str) -> list[int]:
    """表的行目录。索引通常比数据页活得久，所以先走索引拿 rowid；
    连 rowid 都扫不出来时退回 1..max 的暴力遍历。"""
    try:
        return [r[0] for r in conn.execute(f"SELECT rowid FROM {table} ORDER BY rowid")]
    except sqlite3.DatabaseError:
        try:
            top = conn.execute(f"SELECT max(rowid) FROM {table}").fetchone()[0] or 0
        except sqlite3.DatabaseError:
            top = 0
        return list(range(1, int(top) + 1))


def _gutted(row: tuple) -> bool:
    """页被清零之后，SQLite 照样能把 cell 读出来——长度对得上，内容全是 \\x00。
    这种行不会报错，但正文、tags_json 全成了空字节，搬进新库只会在界面上炸成
    一条 JSONDecodeError。这里的表存的全是邮件正文和 JSON，正常值里不可能出现
    \\x00，所以看见就当整行已经没了。"""
    return any(isinstance(v, str) and "\x00" in v for v in row)


def _copy_table(src: sqlite3.Connection, dst: sqlite3.Connection, table: str) -> tuple[int, list[int]]:
    cols = [r[1] for r in src.execute(f"PRAGMA table_info({table})")]
    if not cols:
        return 0, []
    insert = "INSERT INTO {} ({}) VALUES ({})".format(
        table, ", ".join(cols), ", ".join("?" * len(cols))
    )
    kept, lost = 0, []
    for rowid in _rowids(src, table):
        try:
            row = src.execute(f"SELECT {', '.join(cols)} FROM {table} WHERE rowid = ?", (rowid,)).fetchone()
        except sqlite3.DatabaseError:
            lost.append(rowid)          # 这一行的页坏了，跳过它继续搬后面的
            continue
        if row is None:
            continue
        if _gutted(row):
            lost.append(rowid)
            continue
        dst.execute(insert, row)
        kept += 1
    return kept, lost


def _restore_sequences(src: sqlite3.Connection, dst: sqlite3.Connection) -> None:
    """AUTOINCREMENT 的游标要抬回原来的高度，否则丢掉的尾行 id 会被新数据复用。"""
    try:
        seqs = src.execute("SELECT name, seq FROM sqlite_sequence").fetchall()
    except sqlite3.DatabaseError:
        return
    for name, seq in seqs:
        cur = dst.execute("SELECT seq FROM sqlite_sequence WHERE name = ?", (name,)).fetchone()
        if cur is None:
            dst.execute("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)", (name, seq))
        elif cur[0] < seq:
            dst.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = ?", (seq, name))


def repair(db_path: str) -> int:
    if not os.path.exists(db_path):
        print(f"找不到数据库：{db_path}")
        return 1

    rebuilt = db_path + ".rebuilt"
    for leftover in (rebuilt, rebuilt + "-wal", rebuilt + "-shm"):
        if os.path.exists(leftover):
            os.remove(leftover)

    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(rebuilt)
    try:
        for stmt in _schema_sql(src):
            dst.execute(stmt)

        total_lost: dict[str, list[int]] = {}
        for table in _tables(src):
            kept, lost = _copy_table(src, dst, table)
            print(f"  {table}: 搬回 {kept} 行" + (f"，丢失 rowid {lost}" if lost else ""))
            if lost:
                total_lost[table] = lost
        _restore_sequences(src, dst)
        dst.commit()

        bad = dst.execute("PRAGMA integrity_check").fetchall()
        if bad != [("ok",)]:
            print(f"新库自检没过：{bad[:5]}，原库保持不动。")
            return 1
    finally:
        src.close()
        dst.close()

    stamp = time.strftime("%Y%m%d-%H%M%S")
    quarantine = f"{db_path}.corrupt-{stamp}"
    try:
        os.rename(db_path, quarantine)
    except OSError as exc:
        print(f"换不掉原库（{exc}）。服务还开着的话先停掉再跑一遍；新库已经建好在 {rebuilt}。")
        return 1
    # WAL/shm 是给旧库那份页布局用的，跟着一起挪走，别让它们污染新库。
    for ext in ("-wal", "-shm"):
        if os.path.exists(db_path + ext):
            shutil.move(db_path + ext, quarantine + ext)
    os.rename(rebuilt, db_path)

    print(f"\n修好了。原库留在 {quarantine}")
    if total_lost:
        print("以下行读不回来，已经丢了：")
        for table, ids in total_lost.items():
            print(f"  {table} rowid {ids}")
    return 0


if __name__ == "__main__":
    sys.exit(repair(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DB))
