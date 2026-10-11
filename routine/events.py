"""The event schema (version 1).

Every change to the day is one event, appended to that day's .jsonl file. The
markdown sheet and today.json are views computed from these events (D35), so the
events are the only source of truth.

An event is a JSON object:

    {"v": 1, "ts": "2026-10-12T09:03:11+02:00", "day": "2026-10-12",
     "type": "start", "task": "t-...", "session": "...", "cwd": "...",
     "data": {...}}

`task`, `session` and `cwd` are optional; `data` holds the type-specific fields.
"""
from __future__ import annotations

import re
from datetime import datetime

SCHEMA_VERSION = 1

# type -> (fields that must be present in data, does it need a task id?)
TYPES: dict[str, tuple[tuple[str, ...], bool]] = {
    "open_day": (("mode",), False),        # mode: full | normal | light | bad, plus hours
    "task_add": (("title",), True),        # the task card: title, done_when, first_step, perimeter, kind, project
    "carry": (("carried",), True),         # an unfinished task moved into a new day
    "start": ((), True),
    "pause": ((), True),                   # note: what was done, where I stopped, next step
    "done": (("fields",), True),           # fields: the configurable done row (D52)
    "drop": ((), True),
    "inbox": (("text",), False),           # one capture point during the day (D26)
    "inbox_sorted": (("item", "to"), False),
    "said": (("text", "kind"), False),     # things the user said, reusable later (D44)
    "drift_warn": (("message",), True),
    "drift_reply": (("action",), True),    # action: back | continue (+ why)
    "break_start": (("technique",), False),
    "break_end": ((), False),              # phone: bool (D50)
    "usage": (("input_tokens", "output_tokens"), False),
    "close_day": ((), False),              # tomorrow, decisions
}

# Kinds that describe the user's attention never become reusable "said" text (D44).
PRIVATE_SAID_KINDS = {"drift_reply", "mode", "attention"}

TASK_FIELDS_REQUIRED_TO_START = ("done_when", "first_step", "perimeter")

_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class EventError(ValueError):
    """An event that does not follow the schema. Nothing is written."""


def validate(event: dict) -> dict:
    if not isinstance(event, dict):
        raise EventError("an event must be a JSON object")
    if event.get("v") != SCHEMA_VERSION:
        raise EventError(f"unknown schema version: {event.get('v')!r}")
    etype = event.get("type")
    if etype not in TYPES:
        raise EventError(f"unknown event type: {etype!r}")
    if not _DAY.match(str(event.get("day", ""))):
        raise EventError("day must be YYYY-MM-DD")
    try:
        ts = datetime.fromisoformat(str(event.get("ts")))
    except ValueError as exc:
        raise EventError("ts must be an ISO timestamp") from exc
    if ts.tzinfo is None:
        raise EventError("ts must carry its time zone offset")
    required, needs_task = TYPES[etype]
    if needs_task and not event.get("task"):
        raise EventError(f"{etype} needs a task id")
    data = event.get("data", {})
    if not isinstance(data, dict):
        raise EventError("data must be an object")
    missing = [f for f in required if f not in data]
    if missing:
        raise EventError(f"{etype} is missing: {', '.join(missing)}")
    if etype == "said" and data.get("kind") in PRIVATE_SAID_KINDS:
        raise EventError("attention data is never stored as reusable text")
    if etype == "drift_reply" and data.get("action") not in ("back", "continue"):
        raise EventError("drift_reply action must be back or continue")
    if etype == "drift_reply" and data.get("action") == "continue" and not data.get("why"):
        raise EventError("continuing after a drift warning needs a reason")
    return event
