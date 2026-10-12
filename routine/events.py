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
    "task_edit": (("changes",), True),     # change card fields of an existing task (e.g. unset priority)
    "carry": (("carried",), True),         # an unfinished task moved into a new day
    "start": ((), True),
    "pause": ((), True),                   # at the click (D56); reason, and a note when said from chat
    "pause_reason": (("reason",), True),   # why the open pause happened, one of PAUSE_REASONS (D56)
    "checkpoint": (("note",), True),       # leaving: what was done, where I stopped, next step (D47, D56)
    "done": (("fields",), True),           # fields: the configurable done row (D52)
    "drop": ((), True),
    "wait": ((), True),                    # a session works alone on it: paused that moves on (D62)
    "reopen": (("why",), True),            # the only way back from done or dropped (D57)
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

# Why a pause happened, from buttons only so they can be counted (D56). No reason is
# stored as no reason: "other" is the user's pick, never a default.
PAUSE_REASONS = ("planned", "interrupted", "blocked", "switched", "low energy", "lost focus", "other")
# Reasons only the system writes, never offered as buttons: idle = the automatic pause (D59).
SYSTEM_PAUSE_REASONS = ("idle",)

# Kinds that describe the user's attention never become reusable "said" text (D44).
PRIVATE_SAID_KINDS = {"drift_reply", "mode", "attention"}

TASK_FIELDS_REQUIRED_TO_START = ("done_when", "first_step", "perimeter")
EDITABLE_CARD_FIELDS = ("title", "done_when", "first_step", "perimeter", "kind", "project", "priority",
                        "technique")  # technique: the work/break rhythm chosen for the task (D67)

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
    if etype in ("pause", "pause_reason") and "reason" in data and data["reason"] not in PAUSE_REASONS + SYSTEM_PAUSE_REASONS:
        raise EventError(f"unknown pause reason: {data['reason']!r}")
    if etype == "task_edit":
        changes = data.get("changes")
        if not isinstance(changes, dict) or not changes:
            raise EventError("task_edit needs a non-empty changes object")
        unknown = [k for k in changes if k not in EDITABLE_CARD_FIELDS]
        if unknown:
            raise EventError(f"these card fields cannot be edited: {', '.join(unknown)}")
        if any(k in TASK_FIELDS_REQUIRED_TO_START and not str(v).strip() for k, v in changes.items()):
            raise EventError("done_when, first_step and perimeter cannot be emptied")
    if etype == "checkpoint" and not str(data.get("note", "")).strip():
        raise EventError("a checkpoint needs a note")
    if etype == "drift_reply" and data.get("action") not in ("back", "continue", "unanswered"):
        # unanswered: written by the writer when the task is paused or ended with the warning open (D65)
        raise EventError("drift_reply action must be back or continue")
    if etype == "drift_reply" and data.get("action") == "continue" and not data.get("why"):
        raise EventError("continuing after a drift warning needs a reason")
    return event
