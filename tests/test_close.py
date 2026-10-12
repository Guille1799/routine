"""Piece 4: the close sorts every item into one place, the library expires, the fulfilled-day
rate is computed, and the close commits the day (R21, R22, R23, R29, R42, D69)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from routine import datagit, library, paths, sorting, state, stats, writer

REPO = Path(__file__).resolve().parent.parent
CARD = {"title": "Read section 3", "done_when": "notes written", "first_step": "open the pdf",
        "perimeter": "questions, terms, links to my project", "kind": "reading"}

# A project's own entry command: appends one line to its ledger and prints what it wrote.
ADD_PY = """import sys
title, what = sys.argv[1], sys.argv[sys.argv.index('--what') + 1]
if title == 'FAIL':
    print('the ledger refused it', file=sys.stderr); sys.exit(3)
open('LEDGER.md', 'a', encoding='utf-8').write(f'- {title} | {what}\\n')
print('added', title)
"""


@pytest.fixture()
def root(tmp_path, monkeypatch):
    data = tmp_path / "routine-data"
    (data / "config").mkdir(parents=True)
    project = tmp_path / "proj"
    project.mkdir()
    (project / "add.py").write_text(ADD_PY, encoding="utf-8")
    exe = sys.executable.replace("\\", "/")
    (data / "config" / "projects.toml").write_text(
        f'[[project]]\nid = "proj"\npath = "{project.as_posix()}"\n'
        f'entry = "{exe} add.py {{title}} --what {{what}}"\n\n'
        f'[[project]]\nid = "bare"\npath = "{project.as_posix()}"\n', encoding="utf-8")
    monkeypatch.setenv("ROUTINE_DATA_DIR", str(data))
    return data


def ledger(root) -> str:
    f = root.parent / "proj" / "LEDGER.md"
    return f.read_text(encoding="utf-8") if f.exists() else ""


def inbox(root, text="an idea") -> str:
    return writer.record(root, "inbox", {"text": text})[0]["data"]["id"]


def cli(root, *args) -> tuple[int, dict]:
    env = {**os.environ, "ROUTINE_DATA_DIR": str(root), "PYTHONIOENCODING": "utf-8"}
    done = subprocess.run([sys.executable, "-m", "routine", *args], cwd=REPO, env=env,
                          capture_output=True, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)
    return done.returncode, json.loads(done.stdout)


def diary(root, day="2026-10-12") -> list[dict]:
    return state.read_events(paths.diary_file(root, day))


# R21 · D27, D34 -------------------------------------------------------------------------

def test_r21_sorting_runs_the_entry_command_or_holds_the_item(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    a, b = inbox(root, "ask about the grant"), inbox(root, "move the shelf")

    # dry run: the exact command, and nothing written or run
    before = diary(root)
    code, shown = cli(root, "sort", "--dry-run", "--data",
                      json.dumps({"item": a, "project": "proj", "title": "GRANT — ask", "what": "who"}))
    assert code == 0 and shown["dry_run"] is True
    assert shown["command"][1:] == ["add.py", "GRANT — ask", "--what", "who"]
    assert shown["to"] == "ledger:proj"
    assert diary(root) == before and ledger(root) == ""

    # for real: the command runs, the result is an event, the item leaves the inbox
    code, out = cli(root, "sort", "--data",
                    json.dumps({"item": a, "project": "proj", "title": "GRANT — ask", "what": "who"}))
    assert code == 0, out
    assert ledger(root) == "- GRANT — ask | who\n"
    ev = out["events"][-1]
    assert ev["type"] == "inbox_sorted" and ev["data"]["to"] == "ledger:proj"
    assert ev["data"]["exit"] == 0 and "added GRANT — ask" in ev["data"]["output"]
    assert a not in state.current(root)["inbox"]

    # a failing command writes nothing and the item stays: never a silent failure
    code, out = cli(root, "sort", "--data", json.dumps({"item": b, "project": "proj", "title": "FAIL"}))
    assert code == 1 and "the ledger refused it" in out["error"]
    assert b in state.current(root)["inbox"]

    # a project without an entry command: the shared holding list, dated
    code, out = cli(root, "sort", "--data", json.dumps({"item": b, "project": "bare"}))
    assert code == 0 and out["to"] == "holding" and "no entry command" in out["why"]
    held = library.current(root)["holding"][b]
    assert held["held"] == "2026-10-12" and held["project"] == "bare"
    assert "2026-10-12 · move the shelf · project bare" in (root / "holding" / "holding.md").read_text(encoding="utf-8")

    # an unknown project is refused, not guessed
    c = inbox(root, "x")
    code, out = cli(root, "sort", "--data", json.dumps({"item": c, "project": "nope"}))
    assert code == 1 and "unknown project" in out["error"]


def test_r21_an_unfinished_task_goes_to_a_ledger_and_leaves_the_day(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = writer.record(root, "task_add", CARD)[0]["task"]
    code, out = cli(root, "sort", "--task", t, "--data", json.dumps({"project": "proj"}))
    assert code == 0, out
    assert ledger(root) == "- Read section 3 | Read section 3\n"
    st = state.current(root)
    assert st["tasks"][t]["status"] == "dropped"           # it does not carry over
    assert [e for e in diary(root) if e["type"] == "drop"][0]["data"]["sent_to"] == "ledger:proj"
    # a raw drop cannot claim a ledger: only sort, which runs the command, writes that
    t2 = writer.record(root, "task_add", CARD)[0]["task"]
    code, out = cli(root, "drop", "--task", t2, "--data",
                    json.dumps({"sent_to": "ledger:proj", "command": ["x"], "exit": 0}))
    assert code == 1
    raw = subprocess.run([sys.executable, "-m", "routine", "inbox-sorted"], cwd=REPO,
                         capture_output=True, text=True, stdin=subprocess.DEVNULL)
    assert raw.returncode != 0 and "invalid choice" in raw.stderr   # not an action of its own


def test_r21_a_held_item_is_sent_on_once_its_project_has_an_entry(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    a = inbox(root, "talk to the archive")
    sorting.run(root, {"item": a, "project": "bare"})
    with pytest.raises(sorting.SortError, match="still has no entry"):
        sorting.run(root, {"held": a, "project": "bare"})
    sorting.run(root, {"held": a, "project": "proj"})
    assert a not in library.current(root)["holding"]
    assert "talk to the archive" in ledger(root)


# R22 · D32 ------------------------------------------------------------------------------

def test_r22_purpose_makes_a_task_otherwise_content_one_place_per_item(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    dated, plain, both = inbox(root, "call on the 20th"), inbox(root, "a video"), inbox(root, "z")

    # a date is a purpose: a task, never the library (no project: held, with the date)
    assert sorting.run(root, {"item": dated, "date": "2026-10-20"})["to"] == "holding"
    # no purpose: content, into a drawer
    assert sorting.run(root, {"item": plain, "drawer": "to_watch"})["to"] == "library:to_watch"
    # a purpose and a drawer at once: refused, nothing written
    with pytest.raises(sorting.SortError, match="one place per item"):
        sorting.run(root, {"item": both, "project": "proj", "drawer": "ideas"})
    with pytest.raises(sorting.SortError, match="drawer"):
        sorting.run(root, {"item": both})
    assert both in state.current(root)["inbox"] and ledger(root) == ""

    places = library.current(root)
    assert set(places["holding"]) == {dated} and places["holding"][dated]["date"] == "2026-10-20"
    assert set(places["library"]) == {plain}
    # sorted once, gone from the inbox: it cannot be sorted into a second place
    with pytest.raises(sorting.SortError, match="unknown inbox item"):
        sorting.run(root, {"item": plain, "drawer": "ideas"})
    kinds = [(e["data"]["item"], e["data"]["to"]) for e in diary(root) if e["type"] == "inbox_sorted"]
    assert kinds == [(dated, "holding"), (plain, "library:to_watch")]


def test_r22_a_task_without_a_purpose_has_no_library_place(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = writer.record(root, "task_add", CARD)[0]["task"]
    with pytest.raises(sorting.SortError, match="needs a project or a date"):
        sorting.run(root, {"drawer": "ideas"}, task=t)


# R23 · D33 ------------------------------------------------------------------------------

def _day(root, day):
    st = state.current(root)
    if st and st["open"]:
        writer.record(root, "close_day")
    writer.record(root, "open_day", {"mode": "normal"}, day=day)


def test_r23_library_items_expire_after_five_weeks_one_offer_per_close(root):
    _day(root, "2026-09-01")
    old1, old2, fresh = inbox(root, "old article"), inbox(root, "old talk"), inbox(root, "new")
    sorting.run(root, {"item": old1, "drawer": "to_read"})
    sorting.run(root, {"item": old2, "drawer": "to_watch"})
    _day(root, "2026-09-20")
    sorting.run(root, {"item": fresh, "drawer": "ideas"})
    lib = library.current(root)["library"]
    assert lib[old1]["entered"] == lib[old1]["touched"] == "2026-09-01"
    text = (root / "library" / "to_read.md").read_text(encoding="utf-8")
    assert "old article · in 2026-09-01 · touched 2026-09-01" in text

    _day(root, "2026-10-05")            # 34 days: not yet
    assert library.offer(root, "2026-10-05") is None
    writer.record(root, "library_touch", {"item": old2})   # used it: its 5 weeks restart
    _day(root, "2026-10-06")            # 35 days for old1, only 1 for old2
    assert library.offer(root, "2026-10-06")["id"] == old1
    code, out = cli(root, "library", "--day", "2026-10-06")
    assert code == 0 and out["offer"]["id"] == old1

    _day(root, "2026-11-20")            # everything expired; still one offer per close
    assert library.offer(root, "2026-11-20")["id"] == old1      # longest untouched first
    writer.record(root, "library_decide", {"item": old1, "decision": "keep"})
    assert library.offer(root, "2026-11-20") is None             # one decision per close
    assert library.current(root)["library"][old1]["touched"] == "2026-11-20"
    _day(root, "2026-11-21")
    assert library.offer(root, "2026-11-21")["id"] == fresh      # touched 2026-09-20
    sorting.run(root, {"library": fresh, "project": "proj"})     # promote: it found a purpose
    assert fresh not in library.current(root)["library"] and "new" in ledger(root)
    assert library.offer(root, "2026-11-21") is None             # promoting was this close's decision
    _day(root, "2026-11-22")
    assert library.offer(root, "2026-11-22")["id"] == old2
    writer.record(root, "library_decide", {"item": old2, "decision": "drop"})
    assert set(library.current(root)["library"]) == {old1}
    with pytest.raises(writer.RuleError):
        writer.record(root, "library_touch", {"item": old2})     # dropped is gone


def test_r23_promote_and_unknown_items_are_refused_outside_sort(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    code, out = cli(root, "library-decide", "--data",
                    json.dumps({"item": "i-x", "decision": "promote", "to": "holding"}))
    assert code == 1 and "through sort" in out["error"]
    code, out = cli(root, "library-touch", "--data", json.dumps({"item": "i-x"}))
    assert code == 1 and "unknown library item" in out["error"]


# R29 · D7, D41 · R42 · D63 --------------------------------------------------------------

def _priority_day(root, day, end):
    _day(root, day)
    t = writer.record(root, "task_add", {**CARD, "priority": True})[-1]["task"]  # after a replaced one
    if end == "done":
        writer.record(root, "done", {"fields": {}}, task=t)
    elif end == "dropped":
        writer.record(root, "drop", {"note": "the library was closed"}, task=t)
    elif end == "dropped-silently":
        writer.record(root, "drop", task=t)
    return t


def test_r29_fulfilled_day_rate_over_counted_days(root):
    _priority_day(root, "2026-10-01", "done")              # fulfilled
    _priority_day(root, "2026-10-02", "pending")           # priority not done
    # 2026-10-03 not opened: not fulfilled
    _priority_day(root, "2026-10-04", "done")              # fulfilled
    _day(root, "2026-10-05")                               # closed with no priority
    _priority_day(root, "2026-10-06", "done")              # today, not closed: not counted yet
    out = stats.compute(root, "2026-10-06")
    by = {d["day"]: (d["result"], d["why"]) for d in out["days"]}
    assert by == {"2026-10-01": ("fulfilled", "priority done, day closed"),
                  "2026-10-02": ("not fulfilled", "priority not done"),
                  "2026-10-03": ("not fulfilled", "not opened"),
                  "2026-10-04": ("fulfilled", "priority done, day closed"),
                  "2026-10-05": ("not fulfilled", "no priority"),
                  "2026-10-06": ("in progress", "today, not closed yet")}
    assert (out["fulfilled"], out["counted"], out["percent"]) == (2, 5, "40.0 %")
    # a written exception takes a day out of the count
    writer.record(root, "exception", {"for": "2026-10-03", "why": "travelling"})
    with pytest.raises(writer.RuleError):
        writer.record(root, "exception", {"for": "2026-10-09", "why": "ahead"})
    writer.record(root, "close_day")
    code, out = cli(root, "stats", "--day", "2026-10-06")
    assert code == 0 and (out["fulfilled"], out["counted"], out["exceptions"]) == (3, 5, 1)
    assert out["percent"] == "60.0 %" and "target 75 %" in out["summary"]


def test_r42_a_priority_dropped_for_a_reason_is_a_justified_exception(root):
    _priority_day(root, "2026-10-01", "dropped")             # with a reason: exception
    _priority_day(root, "2026-10-02", "dropped-silently")    # no reason: not fulfilled
    t = _priority_day(root, "2026-10-03", "pending")
    sorting.run(root, {"project": "proj"}, task=t)            # postponed to a ledger: not a reason
    t = _priority_day(root, "2026-10-04", "pending")
    writer.record(root, "drop", {"sent_to": "holding", "text": "x", "note": "later"}, task=t)
    _priority_day(root, "2026-10-05", "done")                 # postponed, even with a note
    writer.record(root, "close_day")
    out = stats.compute(root, "2026-10-05")
    by = {d["day"]: d["result"] for d in out["days"]}
    assert by == {"2026-10-01": "exception", "2026-10-02": "not fulfilled",
                  "2026-10-03": "not fulfilled", "2026-10-04": "not fulfilled",
                  "2026-10-05": "fulfilled"}
    assert (out["fulfilled"], out["counted"], out["exceptions"]) == (1, 4, 1)


# D69 ------------------------------------------------------------------------------------

def _git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True,
                          stdin=subprocess.DEVNULL)


def test_d69_the_close_commits_diary_and_state_only(root):
    _git(root, "init", "-q")
    _git(root, "config", "user.email", "demo@example.com")
    _git(root, "config", "user.name", "demo")
    _git(root, "add", "config")
    _git(root, "commit", "-qm", "config")
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    (root / "config" / "projects.toml").write_text("# edited by the user\n", encoding="utf-8")
    code, out = cli(root, "close-day")
    assert code == 0 and out["git"]["committed"] is True, out
    files = _git(root, "show", "--name-only", "--format=", "HEAD").stdout.split()
    assert files == ["diary/2026-10/2026-10-12.jsonl", "state/today.json"]
    assert "config/projects.toml" in _git(root, "status", "--porcelain").stdout  # never committed
    assert _git(root, "log", "-1", "--format=%s").stdout.strip() == "routine: day 2026-10-12 closed"


def test_d69_without_a_git_repository_the_close_says_it_skipped(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    code, out = cli(root, "close-day")
    assert code == 0 and out["git"] == {"committed": False,
                                        "why": "the data folder is not a git repository"}
    assert datagit.commit_day(root, "2026-10-12")["committed"] is False
