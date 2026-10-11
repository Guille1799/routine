"""The single writer (D35).

Sessions, the mod and the morning skill never edit the diary: they call this module
(through the CLI), which takes a lock, checks the rules, appends the events and
refreshes today.json. Two sessions writing at the same moment cannot overwrite each
other, because only one process holds the lock at a time (R4).
"""
from __future__ import annotations

import json
import os
import secrets
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from . import events as ev
from . import paths, state

LOCK_TIMEOUT_S = 10.0


class RuleError(ValueError):
    """The event is well formed but breaks a rule of the routine. Nothing is written."""


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def new_task_id(day: str) -> str:
    return f"t-{day.replace('-', '')}-{secrets.token_hex(3)}"


def _try_lock(fd: int) -> bool:
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def _unlock(fd: int) -> None:
    if os.name == "nt":
        import msvcrt
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_UN)


@contextmanager
def locked(root: Path):
    """An operating-system lock on a file that is never deleted.

    The OS releases the lock when the process ends, even if it crashes, so a stale
    lock cannot block the diary (a create-and-delete lock file can, and on Windows
    it also fails while a deletion is pending).
    """
    lock = paths.lock_file(root)
    lock.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(lock, os.O_RDWR | os.O_CREAT)
    try:
        deadline = time.monotonic() + LOCK_TIMEOUT_S
        while not _try_lock(fd):
            if time.monotonic() > deadline:
                raise TimeoutError(f"the diary is locked by another writer: {lock}")
            time.sleep(0.005)
        try:
            yield
        finally:
            _unlock(fd)
    finally:
        os.close(fd)


def _append(root: Path, events: list[dict]) -> None:
    by_file: dict[Path, list[str]] = {}
    for e in events:
        ev.validate(e)
        by_file.setdefault(paths.diary_file(root, e["day"]), []).append(
            json.dumps(e, ensure_ascii=False))
    for path, lines in by_file.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
            fh.flush()
            os.fsync(fh.fileno())


def _event(etype: str, day: str, data: dict | None = None, task: str | None = None,
           session: str | None = None, cwd: str | None = None) -> dict:
    e = {"v": ev.SCHEMA_VERSION, "ts": now_iso(), "day": day, "type": etype,
         "data": data or {}}
    if task:
        e["task"] = task
    if session:
        e["session"] = session
    if cwd:
        e["cwd"] = cwd
    return e


def _open_day_state(root: Path) -> dict:
    st = state.current(root)
    if not st or not st["open"]:
        raise RuleError("no day is open: run open-day first")
    return st


def record(root: Path, etype: str, data: dict | None = None, task: str | None = None,
           session: str | None = None, cwd: str | None = None,
           day: str | None = None) -> list[dict]:
    """Apply one action under the lock. Returns the events written."""
    data = dict(data or {})
    with locked(root):
        written: list[dict] = []
        if etype == "open_day":
            prev = state.current(root)
            if prev and prev["open"]:
                raise RuleError(f"day {prev['day']} is still open: close it first (D24, D28)")
            today = day or datetime.now().astimezone().date().isoformat()
            if prev and prev["day"] >= today:
                raise RuleError(f"day {today} was already opened")
            written.append(_event("open_day", today, data, session=session, cwd=cwd))
            if prev:  # automatic carry-over (D28): nothing is lost if the close is skipped
                for t in state.unfinished(prev):
                    card = {k: v for k, v in t.items()
                            if k not in ("id", "status", "carried", "notes", "done")}
                    if t["notes"]:
                        card["last_note"] = t["notes"][-1]
                    written.append(_event("carry", today,
                                          {"carried": t["carried"] + 1, "card": card},
                                          task=t["id"]))
                for item_id, item in prev["inbox"].items():
                    written.append(_event("inbox", today, {"text": item["text"],
                                                           "since": item["since"],
                                                           "id": item_id}))
        else:
            st = _open_day_state(root)
            today = st["day"]
            if etype == "task_add":
                task = task or new_task_id(today)
                if task in st["tasks"]:
                    raise RuleError(f"task {task} already exists today")
            elif etype in ("start", "pause", "pause_reason", "checkpoint", "done", "drop",
                           "drift_warn", "drift_reply"):
                if task not in st["tasks"]:
                    raise RuleError(f"unknown task for today: {task}")
            if etype == "start":
                card = st["tasks"][task]
                missing = [f for f in ev.TASK_FIELDS_REQUIRED_TO_START if not card.get(f)]
                if missing:
                    raise RuleError(f"the task card is incomplete: {', '.join(missing)} (D10, D37)")
                if st["active"] and st["active"] != task:  # one active task at a time (D10)
                    written.append(_event("pause", today,
                                          {"note": "auto-paused: another task started",
                                           "reason": "switched"},
                                          task=st["active"], session=session, cwd=cwd))
            if etype == "pause" and st["tasks"][task]["status"] != "active":
                raise RuleError(f"only the active task can be paused: {task} is {st['tasks'][task]['status']}")
            if etype == "pause_reason" and not (st["last_paused"] == task
                                                and st["tasks"][task]["status"] == "paused"):
                # the reason belongs to the pause still open; after Resume it stays as it was (D56)
                raise RuleError("this task has no open pause to give a reason to")
            if etype == "drift_warn":  # warn once per drift episode (D9, D54)
                dr = st["drift"].get(task)
                if dr and dr["open"]:
                    raise RuleError("this task already has an unanswered drift warning")
                if dr and dr["replies"] and dr["replies"][-1].get("action") == "continue":
                    raise RuleError("the user already justified staying on this; no new warning")
            if etype == "drift_reply" and not (st["drift"].get(task) or {}).get("open"):
                raise RuleError("there is no open drift warning to answer")
            if etype == "inbox" and "id" not in data:
                data["id"] = f"i-{secrets.token_hex(4)}"
            if etype == "inbox_sorted" and data.get("item") not in st["inbox"]:
                raise RuleError(f"unknown inbox item: {data.get('item')}")
            written.append(_event(etype, today, data, task=task, session=session, cwd=cwd))
        _append(root, written)
        state.write_snapshot(root, state.current(root))
        return written


def refresh(root: Path) -> None:
    """Rebuild today.json from the diary, writing no event.

    The mod calls it every time it loads, so a copy folded by older code cannot outlive
    a code change. Under the lock, so it never overwrites a newer copy a writer just made.
    """
    with locked(root):
        state.write_snapshot(root, state.current(root))
