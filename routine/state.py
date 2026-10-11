"""Fold a day's events into its current state. Pure functions: no files, no clock."""
from __future__ import annotations

import json
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


def fold(events: list[dict]) -> dict:
    """Return the state of one day: tasks, active task, inbox, break, open/closed."""
    st: dict = {
        "day": None, "open": False, "closed": False, "mode": None, "hours": None,
        "tasks": {}, "order": [], "active": None, "inbox": {}, "break": None,
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
            st["tasks"][tid]["status"] = "active"
            st["active"] = tid
        elif t in ("pause", "done", "drop"):
            task = st["tasks"][tid]
            task["status"] = {"pause": "paused", "done": "done", "drop": "dropped"}[t]
            if d.get("note"):
                task["notes"].append(d["note"])
            if t == "done":
                task["done"] = d.get("fields", {})
            if st["active"] == tid:
                st["active"] = None
        elif t == "inbox":
            st["inbox"][ev.get("data", {}).get("id") or ev["ts"]] = {
                "text": d["text"], "since": d.get("since", ev["ts"])}
        elif t == "inbox_sorted":
            st["inbox"].pop(d["item"], None)
        elif t == "drift_warn":
            st["drift"].setdefault(tid, {"warned": 0, "replies": []})["warned"] += 1
        elif t == "drift_reply":
            st["drift"].setdefault(tid, {"warned": 0, "replies": []})["replies"].append(d)
        elif t == "break_start":
            st["break"] = {"technique": d["technique"], "minutes": d.get("minutes"),
                           "since": ev["ts"]}
        elif t == "break_end":
            st["break"] = None
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
