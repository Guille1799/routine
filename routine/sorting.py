"""Close-time sorting: every item goes to one place (D27, D32, D34).

The purpose rule (D32): an item with a purpose, a date or a project, is a **task** and
goes to that project's ledger through the project's own entry command (D27). A project
without an entry command is not a valid destination, so the item goes to the shared
holding list, dated (D34); a date with no project goes there too, because there is no
ledger to send it to. An item with no purpose is **content** and goes to a library drawer.

What can be sorted:

- an inbox item (`item`): the inbox is the day's capture point (D26);
- an unfinished task (`--task`): it leaves the day as dropped, with the place it went to;
- a held item (`held`): sent on once its project has an entry command;
- a library item (`library`): promoting it, because it found a purpose (D33).

The entry command runs **before** anything is written, outside the diary's lock (it may
take seconds), and only an exit code of 0 writes the event. A failed command writes
nothing and the item stays where it was, so a failure is never silent and nothing is lost.
`dry_run` shows the exact command and writes nothing: the close shows it to the user and
runs it only after a yes.
"""
from __future__ import annotations

import re
import shlex
import subprocess
from pathlib import Path

from . import config, library, state, writer
from . import events as ev

COMMAND_TIMEOUT_S = 60
OUTPUT_KEPT = 2000
SOURCES = ("item", "held", "library")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class SortError(ValueError):
    """The item cannot go where it was asked to. Nothing is written."""


def _source(root: Path, st: dict, task: str | None, data: dict) -> tuple[str, str, str]:
    """(kind, id, text) of the thing being sorted."""
    given = [k for k in SOURCES if data.get(k)] + (["task"] if task else [])
    if len(given) != 1:
        raise SortError("sort one thing at a time: an inbox item, a task, a held item "
                        "or a library item")
    kind = given[0]
    if kind == "task":
        t = st["tasks"].get(task)
        if not t:
            raise SortError(f"unknown task for today: {task}")
        if t["status"] in writer.FINAL:
            raise SortError(f"{task} is {t['status']}: there is nothing left to sort")
        return "task", task, t.get("title", task)
    ident = data[kind]
    if kind == "item":
        if ident not in st["inbox"]:
            raise SortError(f"unknown inbox item: {ident}")
        return kind, ident, st["inbox"][ident]["text"]
    places = library.current(root)
    pool = places["holding" if kind == "held" else "library"]
    if ident not in pool:
        raise SortError(f"unknown {'holding' if kind == 'held' else 'library'} item: {ident}")
    return kind, ident, pool[ident].get("title") or pool[ident]["text"]


def plan(root: Path, data: dict, task: str | None = None) -> dict:
    """Where the item goes and, for a ledger, the exact command. Reads only."""
    st = state.current(root)
    if not st or not st["open"]:
        raise SortError("no day is open: sorting happens before the close")
    kind, ident, text = _source(root, st, task, data)
    project, day, drawer = data.get("project"), data.get("date"), data.get("drawer")
    if day and not _DAY.match(str(day)):
        raise SortError("date must be YYYY-MM-DD")
    if drawer and (project or day):
        raise SortError("one place per item (D32): a project or a date makes it a task; "
                        "a drawer makes it content. Give one, not both")
    out = {"source": kind, "id": ident, "text": text}
    if not (project or day):  # no purpose: content (D32)
        if kind != "item":
            raise SortError(f"a {'task' if kind == 'task' else kind + ' item'} needs a project "
                            "or a date to go anywhere: only inbox items go to the library")
        if drawer not in ev.DRAWERS:
            raise SortError(f"content goes to a library drawer: one of {', '.join(ev.DRAWERS)}")
        return {**out, "to": f"library:{drawer}"}
    title = str(data.get("title") or text)
    what = str(data.get("what") or text)
    out.update(title=title, what=what)
    if day:
        out["date"] = day
    if not project:
        return {**out, "to": "holding", "why": "a date but no project: there is no ledger to send it to"}
    projects = config.projects(root)
    if project not in projects:
        raise SortError(f"unknown project: {project} (projects.toml has: {', '.join(projects)})")
    out["project"] = project
    p = projects[project]
    if not p["entry"]:
        if kind == "held":
            raise SortError(f"{project} still has no entry command: the item stays held")
        return {**out, "to": "holding", "why": f"{project} has no entry command (D34)"}
    values = {"title": title, "what": what, "date": day or "", "project": project}
    argv = [token.format_map(values) for token in shlex.split(p["entry"])]
    exe = Path(argv[0])
    if not exe.is_absolute() and len(exe.parts) > 1:  # a path inside the project, not a PATH name
        argv[0] = str(p["path"] / exe)
    return {**out, "to": f"ledger:{project}", "command": argv, "cwd": str(p["path"])}


def run(root: Path, data: dict, task: str | None = None, dry_run: bool = False,
        session: str | None = None, cwd: str | None = None) -> dict:
    """Sort one thing: plan it, run the entry command if any, then write the event."""
    p = plan(root, data, task)
    if dry_run:
        return {**p, "dry_run": True}
    details = {k: p[k] for k in ("text", "project", "date", "title", "what", "why") if k in p}
    if p["to"].startswith("ledger:"):
        try:
            done = subprocess.run(p["command"], cwd=p["cwd"], capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL,
                                  timeout=COMMAND_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise SortError(f"the entry command of {p['project']} could not run: {exc}. "
                            "Nothing was written; the item stays where it was") from exc
        output = (done.stdout + done.stderr).strip()[-OUTPUT_KEPT:]
        if done.returncode != 0:
            raise SortError(f"the entry command of {p['project']} failed (exit {done.returncode}): "
                            f"{output or 'no output'}. Nothing was written; the item stays where it was")
        details.update(command=p["command"], exit=0, output=output)
    if p["source"] == "task":
        written = writer.record(root, "drop", {"sent_to": p["to"], **details}, task=p["id"],
                                session=session, cwd=cwd)
    elif p["source"] == "library":
        written = writer.record(root, "library_decide", {"item": p["id"], "decision": "promote",
                                                         "to": p["to"], **details},
                                session=session, cwd=cwd)
    else:
        etype = "inbox_sorted" if p["source"] == "item" else "held_sorted"
        written = writer.record(root, etype, {"item": p["id"], "to": p["to"], **details},
                                session=session, cwd=cwd)
    return {**p, "events": written}
