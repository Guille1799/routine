"""Tests for the single writer: the rules every other piece relies on."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from routine import events, paths, state, writer

REPO = Path(__file__).resolve().parent.parent
CARD = {"title": "Read section 3", "done_when": "notes written", "first_step": "open the pdf",
        "perimeter": "questions, terms, links to my project", "kind": "reading"}


@pytest.fixture()
def root(tmp_path, monkeypatch):
    data = tmp_path / "routine-data"
    data.mkdir()
    monkeypatch.setenv("ROUTINE_DATA_DIR", str(data))
    return data


def add(root, **over):
    return writer.record(root, "task_add", {**CARD, **over})[0]["task"]


def test_r30_missing_data_dir_fails_loudly(monkeypatch, tmp_path):
    monkeypatch.setenv("ROUTINE_DATA_DIR", str(tmp_path / "nope"))
    with pytest.raises(paths.DataDirError):
        paths.data_dir()


def test_r1_data_dir_cannot_live_inside_the_repo(monkeypatch):
    monkeypatch.setenv("ROUTINE_DATA_DIR", str(REPO / "tests"))
    with pytest.raises(paths.DataDirError):
        paths.data_dir()


def test_r5_schema_rejects_invalid_events():
    good = {"v": 1, "ts": "2026-10-12T09:00:00+02:00", "day": "2026-10-12",
            "type": "inbox", "data": {"text": "x"}}
    events.validate(good)
    for bad in ({**good, "v": 2}, {**good, "type": "nope"}, {**good, "ts": "2026-10-12T09:00:00"},
                {**good, "data": {}}, {**good, "type": "start"}):
        with pytest.raises(events.EventError):
            events.validate(bad)


def test_r7_no_new_day_while_one_is_open(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    with pytest.raises(writer.RuleError):
        writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-13")


def test_r6_starting_a_task_pauses_the_active_one(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    a, b = add(root), add(root, title="Python exercise")
    writer.record(root, "start", task=a)
    writer.record(root, "start", task=b)
    st = state.current(root)
    assert st["active"] == b
    assert st["tasks"][a]["status"] == "paused"


def test_r14_incomplete_card_cannot_start(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root, perimeter="")
    with pytest.raises(writer.RuleError):
        writer.record(root, "start", task=t)


def test_r8_unfinished_tasks_and_inbox_carry_over_with_a_counter(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root)
    writer.record(root, "pause", {"note": "did A, stopped at B, next C"}, task=t)
    writer.record(root, "inbox", {"text": "video about housing"})
    writer.record(root, "close_day", {"tomorrow": "finish it"})
    writer.record(root, "open_day", {"mode": "light"}, day="2026-10-13")
    writer.record(root, "close_day")
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-14")
    st = state.current(root)
    assert st["tasks"][t]["carried"] == 2            # same id across days
    assert st["tasks"][t]["last_note"].startswith("did A")
    assert [i["text"] for i in st["inbox"].values()] == ["video about housing"]


def test_r28_attention_data_never_becomes_reusable_text(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    writer.record(root, "said", {"text": "evals need judges", "kind": "statement"})
    with pytest.raises(events.EventError):
        writer.record(root, "said", {"text": "x", "kind": "drift_reply"})


def test_r18_continuing_after_a_drift_warning_needs_a_reason(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root)
    writer.record(root, "drift_warn", {"message": "about another project"}, task=t)
    with pytest.raises(events.EventError):
        writer.record(root, "drift_reply", {"action": "continue"}, task=t)
    writer.record(root, "drift_reply", {"action": "continue", "why": "deadline today"}, task=t)
    assert state.current(root)["drift"][t]["warned"] == 1


def test_r4_concurrent_writers_never_lose_an_event(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    script = ("import sys; from routine import writer, paths\n"
              "r = paths.data_dir()\n"
              "for i in range(25): writer.record(r, 'inbox', {'text': f'{sys.argv[1]}-{i}'})\n")
    env = {**os.environ, "PYTHONPATH": str(REPO)}
    procs = [subprocess.Popen([sys.executable, "-c", script, str(n)], env=env,
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE) for n in range(8)]
    errors = [p.communicate(timeout=120)[1] for p in procs]
    assert all(p.returncode == 0 for p in procs), errors
    lines = paths.diary_file(root, "2026-10-12").read_text(encoding="utf-8").splitlines()
    inbox = [json.loads(line) for line in lines if '"inbox"' in line]
    assert len(inbox) == 8 * 25
    assert len(state.current(root)["inbox"]) == 8 * 25


def test_cli_exit_codes(root):
    run = lambda *a: subprocess.run([sys.executable, "-m", "routine", *a], cwd=REPO,
                                    capture_output=True, text=True,
                                    stdin=subprocess.DEVNULL)
    assert run("open-day", "--data", '{"mode":"normal"}', "--day", "2026-10-12").returncode == 0
    assert run("start", "--task", "t-missing").returncode == 1
    env_missing = subprocess.run([sys.executable, "-m", "routine", "status"], cwd=REPO,
                                 capture_output=True, text=True, stdin=subprocess.DEVNULL,
                                 env={**os.environ, "ROUTINE_DATA_DIR": str(root / "x")})
    assert env_missing.returncode == 2


RACE = ("import sys; from routine import writer, paths\n"
        "try:\n    writer.record(paths.data_dir(), 'open_day', {'mode': 'normal'}, day='2026-10-12')\n"
        "except writer.RuleError:\n    sys.exit(3)\n")


def race_open_day(root, script=RACE, n=8):
    env = {**os.environ, "PYTHONPATH": str(REPO)}
    procs = [subprocess.Popen([sys.executable, "-c", script], env=env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE) for _ in range(n)]
    for p in procs:
        p.communicate(timeout=120)
    return [p.returncode for p in procs]


def test_r4_r7_racing_writers_open_the_day_exactly_once(tmp_path, monkeypatch):
    # Calibrated on 11-oct-2026: with the lock removed, ONE round of 12 racers double-opened
    # the day in 2 of 5 runs. Five rounds push the chance of catching a broken lock to ~92 %.
    for rnd in range(5):
        root = tmp_path / f"round-{rnd}"
        root.mkdir()
        monkeypatch.setenv("ROUTINE_DATA_DIR", str(root))
        codes = race_open_day(root, n=12)
        assert codes.count(0) == 1 and codes.count(3) == len(codes) - 1, codes
        lines = paths.diary_file(root, "2026-10-12").read_text(encoding="utf-8").splitlines()
        assert sum('"open_day"' in line for line in lines) == 1
