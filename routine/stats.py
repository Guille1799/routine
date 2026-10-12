"""The success criterion: the rate of fulfilled days (D7, D41, D63).

A day is **fulfilled** when its priority is done and the day is closed (D41). The routine
works if 75 % of counted days are fulfilled (D7).

- **Counted days** are every calendar day from the first day in the diary (or `since`) to
  today. Today counts only once it is closed: a day still running has not failed yet.
- A day **not opened** counts as not fulfilled (D41, review C18).
- A **justified exception** is neither fulfilled nor failed, and leaves the rate: a day
  whose priority was dropped with a reason (D63), or any day with a written exception
  (`python -m routine exception --data '{"for": "YYYY-MM-DD", "why": "..."}'`) (D7).
  A priority sent to a ledger or the holding list at the close was postponed, not dropped
  for a reason, so it is not an exception.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from . import library, state

TARGET = 0.75   # D7


def _priority(st: dict) -> list[dict]:
    return [t for t in st["tasks"].values() if t.get("priority") is True]


def _dropped_for_a_reason(st: dict, events: list[dict]) -> bool:
    for t in _priority(st):
        if t["status"] != "dropped":
            continue
        drops = [e["data"] for e in events if e["type"] == "drop" and e.get("task") == t["id"]]
        last = drops[-1] if drops else {}
        if "sent_to" not in last and str(last.get("reason") or last.get("note") or "").strip():
            return True
    return False


def judge(st: dict | None, events: list[dict], written: str | None) -> tuple[str, str]:
    """(result, why) for one day: fulfilled, exception or not fulfilled."""
    if written:
        return "exception", f"written exception: {written}"
    if not st or not st["open"] and not st["closed"]:
        return "not fulfilled", "not opened"
    if _dropped_for_a_reason(st, events):
        return "exception", "priority dropped for a reason (D63)"
    if not st["closed"]:
        return "not fulfilled", "not closed"
    prio = _priority(st)
    if not prio:
        return "not fulfilled", "no priority"
    if any(t["status"] == "done" for t in prio):
        return "fulfilled", "priority done, day closed"
    return "not fulfilled", "priority not done"


def compute(root: Path, today: str, since: str | None = None) -> dict:
    events = library.all_events(root)
    by_day: dict[str, list[dict]] = {}
    for e in events:
        by_day.setdefault(e["day"], []).append(e)
    written = {e["data"]["for"]: e["data"]["why"] for e in events if e["type"] == "exception"}
    first = since or (min(by_day) if by_day else today)
    days, d = [], date.fromisoformat(first)
    end = date.fromisoformat(today)
    while d <= end:
        day = d.isoformat()
        evs = by_day.get(day, [])
        st = state.fold(evs) if evs else None
        if day == today and not (st and st["closed"]) and day not in written:
            days.append({"day": day, "result": "in progress", "why": "today, not closed yet"})
        else:
            result, why = judge(st, evs, written.get(day))
            days.append({"day": day, "result": result, "why": why})
        d += timedelta(days=1)
    fulfilled = sum(x["result"] == "fulfilled" for x in days)
    failed = sum(x["result"] == "not fulfilled" for x in days)
    exceptions = sum(x["result"] == "exception" for x in days)
    counted = fulfilled + failed
    rate = fulfilled / counted if counted else None
    percent = f"{rate * 100:.1f} %" if rate is not None else "no counted days yet"
    return {"ok": True, "from": first, "to": today, "fulfilled": fulfilled, "not_fulfilled": failed,
            "exceptions": exceptions, "counted": counted, "rate": rate, "percent": percent,
            "target": f"{TARGET * 100:.0f} %",
            "summary": f"{fulfilled} of {counted} counted days fulfilled: {percent} "
                       f"(target {TARGET * 100:.0f} %; {exceptions} justified exceptions left out)",
            "days": days}
