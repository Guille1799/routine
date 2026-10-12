"""The library and the holding list: places items live in after the day that sorted them.

Both are folded from the diary of every day, like today.json is folded from one day (D35):
the events are the truth, and `library/<drawer>.md` and `holding/holding.md` are views the
writer rewrites. Nobody edits them by hand.

- The **library** keeps content without a purpose (D32): to read, to watch, open topics,
  ideas (D26). Each item has the day it came in and the day it was last touched. An item
  untouched for 5 weeks asks for a decision, one per close (D33).
- The **holding list** keeps items that have a purpose but no way into a project's ledger
  yet (D34), each with the day it was held. They are sent on with `sort` once the project
  has an entry command.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from . import events as ev
from . import state

EXPIRES_AFTER = timedelta(weeks=5)   # D33

TITLES = {"to_read": "To read", "to_watch": "To watch", "open_topics": "Open topics",
          "ideas": "Ideas to build"}


def all_events(root: Path) -> list[dict]:
    diary = root / "diary"
    files = sorted(diary.glob("*/*.jsonl")) if diary.exists() else []
    return [e for f in files for e in state.read_events(f)]


def _place(lib: dict, held: dict, e: dict, item: str, to: str) -> None:
    d = e["data"]
    if to.startswith("library:"):
        lib[item] = {"id": item, "text": d["text"], "drawer": to.split(":", 1)[1],
                     "entered": e["day"], "touched": e["day"]}
    elif to == "holding":
        held[item] = {"id": item, "text": d["text"], "held": e["day"],
                      **{k: d[k] for k in ("project", "date", "title", "what", "why") if d.get(k)}}


def fold(events: list[dict]) -> dict:
    """The library and the holding list after these events (all days, in order)."""
    lib: dict[str, dict] = {}
    held: dict[str, dict] = {}
    for e in events:
        t, d = e["type"], e.get("data", {})
        if t == "inbox_sorted":
            _place(lib, held, e, d["item"], d["to"])
        elif t == "drop" and "sent_to" in d:
            _place(lib, held, e, e["task"], d["sent_to"])
        elif t == "held_sorted":
            held.pop(d["item"], None)
            _place(lib, held, e, d["item"], d["to"])
        elif t == "library_touch" and d["item"] in lib:
            lib[d["item"]]["touched"] = e["day"]
        elif t == "library_decide" and d["item"] in lib:
            if d["decision"] == "keep":
                lib[d["item"]]["touched"] = e["day"]
            else:
                gone = lib.pop(d["item"])
                if d["decision"] == "promote":
                    _place(lib, held, {**e, "data": {"text": gone["text"], **d}}, d["item"], d["to"])
    return {"library": lib, "holding": held}


def current(root: Path) -> dict:
    return fold(all_events(root))


def expired(lib: dict, today: str) -> list[dict]:
    """Items untouched for 5 weeks or more, the longest untouched first."""
    cut = date.fromisoformat(today) - EXPIRES_AFTER
    old = [i for i in lib.values() if date.fromisoformat(i["touched"]) <= cut]
    return sorted(old, key=lambda i: (i["touched"], i["entered"], i["id"]))


def offer(root: Path, today: str) -> dict | None:
    """The one expired item this close asks about, or None (D33).

    One per close: once a decision was written today, nothing more is offered until the
    next day, however many items have expired.
    """
    events = all_events(root)
    if any(e["type"] == "library_decide" and e["day"] == today for e in events):
        return None
    old = expired(fold(events)["library"], today)
    return old[0] if old else None


def render(places: dict) -> dict[str, str]:
    """The markdown views, by path relative to the data folder."""
    header = ("Written by the routine from the diary. Change it with `python -m routine`, "
              "never by hand.\n")
    out = {}
    for drawer in ev.DRAWERS:
        items = sorted((i for i in places["library"].values() if i["drawer"] == drawer),
                       key=lambda i: (i["entered"], i["id"]))
        lines = [f"# {TITLES[drawer]}", "", header]
        lines += [f"- {i['text']} · in {i['entered']} · touched {i['touched']} · `{i['id']}`"
                  for i in items] or ["Nothing here."]
        out[f"library/{drawer}.md"] = "\n".join(lines) + "\n"
    lines = ["# Holding list", "",
             "Items with a purpose whose project has no entry command yet (D34).", "", header]
    for i in sorted(places["holding"].values(), key=lambda i: (i["held"], i["id"])):
        extra = "".join(f" · {k} {i[k]}" for k in ("project", "date") if i.get(k))
        lines.append(f"- {i['held']} · {i.get('title') or i['text']}{extra} · `{i['id']}`")
    if not places["holding"]:
        lines.append("Nothing held.")
    out["holding/holding.md"] = "\n".join(lines) + "\n"
    return out


# Event types that change what the views show.
CHANGES_VIEWS = {"inbox_sorted", "held_sorted", "library_touch", "library_decide", "drop"}


def write_views(root: Path, places: dict | None = None) -> None:
    for rel, text in render(places or current(root)).items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(target)
