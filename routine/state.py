"""Fold a day's events into its current state. Pure functions: no files, no clock."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from . import paths


def read_events(path: Path) -> list[dict]:
    if not path.exists():
        return []
    events = []
    with path.open(encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{n} is not valid JSON") from exc
    return events


def break_minutes(technique: str | None) -> int | None:
    """The break length of a technique like "pomodoro 25/5" or "50/10"; None when it has none."""
    if not technique or "/" not in technique:
        return None
    try:
        return int(technique.rsplit("/", 1)[1].strip())
    except ValueError:
        return None


# Without a technique, a pause shorter than this keeps the work counter running (D76).
DEFAULT_SHORT_PAUSE = 5


def _minutes_between(a: str, b: str) -> float:
    return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() / 60


def fold(events: list[dict]) -> dict:
    """Return the state of one day: tasks, active task, inbox, break, open/closed."""
    st: dict = {
        "day": None, "open": False, "closed": False, "mode": None, "hours": None,
        "tasks": {}, "order": [], "active": None, "last_paused": None, "inbox": {}, "break": None,
        "last_break_end": None,
        "drift": {}, "tomorrow": None, "last_ts": None,
    }
    for ev in events:
        t, d, tid = ev["type"], ev.get("data", {}), ev.get("task")
        st["day"] = st["day"] or ev["day"]
        st["last_ts"] = ev["ts"]
        if t == "open_day":
            st.update(open=True, mode=d.get("mode"), hours=d.get("hours"))
        elif t in ("task_add", "carry"):
            card = dict(d.get("card", d))
            card.pop("carried", None)
            st["tasks"][tid] = {
                "id": tid, **card, "status": "pending",
                "carried": d.get("carried", 0) if t == "carry" else 0,
                "notes": [],
            }
            st["order"].append(tid)
        elif t == "start":
            if ev.get("session"):  # the session that works on it (D64): its band shows this task
                st["tasks"][tid]["session"] = ev["session"]
            task = st["tasks"][tid]
            task["status"] = "active"
            task["since"] = ev["ts"]
            # The work phase (D73): a pause shorter than the technique's break continues the
            # phase where it was; a longer one counted as a break, so a new phase starts.
            paused_at, worked_from = task.pop("paused_at", None), task.get("work_started")
            limit = break_minutes(task.get("technique")) or DEFAULT_SHORT_PAUSE  # D76
            if paused_at and worked_from and limit and _minutes_between(paused_at, ev["ts"]) < limit:
                shift = datetime.fromisoformat(ev["ts"]) - datetime.fromisoformat(paused_at)
                task["work_started"] = (datetime.fromisoformat(worked_from) + shift).isoformat(timespec="seconds")
            else:
                task["work_started"] = ev["ts"]
            st["active"] = tid
            if st["last_paused"] == tid:
                st["last_paused"] = None
        elif t == "task_edit":
            st["tasks"][tid].update(d["changes"])
        elif t == "reopen":
            st["tasks"][tid]["status"] = "pending"
            st["tasks"][tid].setdefault("reopened", []).append(d["why"])
        elif t == "wait":
            task = st["tasks"][tid]
            if ev.get("session"):
                task["session"] = ev["session"]
            task["status"] = "waiting"
            task["waiting_since"] = ev["ts"]
            task.pop("since", None)
            if st["active"] == tid:
                st["active"] = None
        elif t in ("pause", "done", "drop"):
            task = st["tasks"][tid]
            task["status"] = {"pause": "paused", "done": "done", "drop": "dropped"}[t]
            if d.get("note"):
                task["notes"].append(d["note"])
            if t == "done":
                task["done"] = d.get("fields", {})
            task.pop("since", None)
            if st["active"] == tid:
                st["active"] = None
            # the task the band offers to resume: the last one paused, while it is still paused
            if t == "pause":
                task["paused_at"] = ev["ts"]
                st["last_paused"] = tid
                task.setdefault("pauses", []).append({"at": ev["ts"], "reason": d.get("reason")})
            elif st["last_paused"] == tid:
                st["last_paused"] = None
        elif t == "pause_reason":
            st["tasks"][tid]["pauses"][-1]["reason"] = d["reason"]
        elif t == "checkpoint":
            st["tasks"][tid]["notes"].append(d["note"])
        elif t == "usage" and tid in st["tasks"]:
            tok = st["tasks"][tid].setdefault("tokens", {"input": 0, "output": 0})
            tok["input"] += (d.get("input_tokens", 0) + d.get("cache_read_input_tokens", 0)
                             + d.get("cache_creation_input_tokens", 0))
            tok["output"] += d.get("output_tokens", 0)
        elif t == "inbox":
            st["inbox"][ev.get("data", {}).get("id") or ev["ts"]] = {
                "text": d["text"], "since": d.get("since", ev["ts"])}
        elif t == "inbox_sorted":
            st["inbox"].pop(d["item"], None)
        elif t == "drift_warn":
            dr = st["drift"].setdefault(tid, {"warned": 0, "replies": [], "open": False})
            dr["warned"] += 1
            dr["open"] = True
        elif t == "drift_reply":
            dr = st["drift"].setdefault(tid, {"warned": 0, "replies": [], "open": False})
            dr["replies"].append(d)
            dr["open"] = False
        elif t == "break_start":
            st["break"] = {"technique": d["technique"], "minutes": d.get("minutes"),
                           "since": ev["ts"]}
        elif t == "break_end":
            st["break"] = None
            st["last_break_end"] = ev["ts"]  # the work phase restarts here (D67)
            if st["active"]:
                st["tasks"][st["active"]]["work_started"] = ev["ts"]
        elif t == "close_day":
            st.update(open=False, closed=True, tomorrow=d.get("tomorrow"), active=None)
    return st


def unfinished(st: dict) -> list[dict]:
    return [st["tasks"][i] for i in st["order"]
            if st["tasks"][i]["status"] not in ("done", "dropped")]


def latest_day_file(root: Path) -> Path | None:
    diary = root / "diary"
    if not diary.exists():
        return None
    files = sorted(diary.glob("*/*.jsonl"))
    return files[-1] if files else None


def current(root: Path) -> dict | None:
    """State of the most recent day, open or closed; None if there is no diary yet."""
    latest = latest_day_file(root)
    return fold(read_events(latest)) if latest else None


def write_snapshot(root: Path, st: dict | None) -> None:
    """today.json is a read model for the mod and the skill; never a source of truth."""
    target = paths.state_file(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(target)
