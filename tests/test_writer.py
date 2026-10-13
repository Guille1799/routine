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


def test_r17_last_paused_is_the_task_the_band_offers_to_resume(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    a, b = add(root), add(root, title="Python exercise")
    writer.record(root, "start", task=a)
    writer.record(root, "pause", task=a)
    assert state.current(root)["last_paused"] == a
    writer.record(root, "start", task=b)       # starting another keeps a as the one to resume
    writer.record(root, "pause", task=b)
    assert state.current(root)["last_paused"] == b
    writer.record(root, "start", task=b)       # resumed: nothing left to offer
    assert state.current(root)["last_paused"] is None


def test_r17_refresh_rebuilds_a_stale_copy_without_writing_an_event(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    a = add(root)
    writer.record(root, "start", task=a)
    writer.record(root, "pause", task=a)
    snap = paths.state_file(root)
    stale = json.loads(snap.read_text(encoding="utf-8"))
    del stale["last_paused"]                    # as older code wrote it
    snap.write_text(json.dumps(stale), encoding="utf-8")
    diary = paths.diary_file(root, "2026-10-12").read_text(encoding="utf-8")
    writer.refresh(root)
    assert json.loads(snap.read_text(encoding="utf-8"))["last_paused"] == a
    assert paths.diary_file(root, "2026-10-12").read_text(encoding="utf-8") == diary


def test_r14_incomplete_card_cannot_start(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root, perimeter="")
    with pytest.raises(writer.RuleError):
        writer.record(root, "start", task=t)


def test_r8_unfinished_tasks_and_inbox_carry_over_with_a_counter(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root)
    writer.record(root, "start", task=t)
    writer.record(root, "pause", task=t)
    writer.record(root, "checkpoint", {"note": "did A, stopped at B, next C"}, task=t)
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


def test_r17_active_task_has_a_start_time_for_the_band(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root)
    writer.record(root, "start", task=t)
    assert state.current(root)["tasks"][t]["since"]
    writer.record(root, "pause", task=t)
    assert "since" not in state.current(root)["tasks"][t]


def test_r27_usage_is_summed_per_task_and_shown(root):
    from routine import view
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root)
    for _ in range(3):
        writer.record(root, "usage", {"input_tokens": 10, "output_tokens": 5,
                                      "cache_read_input_tokens": 100,
                                      "cache_creation_input_tokens": 1}, task=t)
    assert state.current(root)["tasks"][t]["tokens"] == {"input": 333, "output": 15}
    assert "333 in / 15 out" in view.render(state.current(root))


def test_r32_done_fields_come_from_the_user_config(root):
    from routine import config
    (root / "config").mkdir()
    with pytest.raises(config.ConfigError):
        config.done_fields(root)
    example = REPO / "examples" / "data" / "config" / "done_fields.toml"
    (root / "config" / "done_fields.toml").write_text(example.read_text(encoding="utf-8"),
                                                      encoding="utf-8")
    ids = [f["id"] for f in config.done_fields(root)]
    assert ids[0] == "rating" and "note" in ids
    (root / "config" / "done_fields.toml").write_text('[[field]]\nid = "x"\nkind = "dial"\n',
                                                      encoding="utf-8")
    with pytest.raises(config.ConfigError):
        config.done_fields(root)


def test_r18_drift_is_warned_once_per_episode(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root)
    writer.record(root, "drift_warn", {"message": "m1"}, task=t)
    with pytest.raises(writer.RuleError):            # unanswered warning still open
        writer.record(root, "drift_warn", {"message": "m2"}, task=t)
    writer.record(root, "drift_reply", {"action": "back"}, task=t)
    writer.record(root, "drift_warn", {"message": "m3"}, task=t)   # new episode after "back"
    writer.record(root, "drift_reply", {"action": "continue", "why": "deadline"}, task=t)
    with pytest.raises(writer.RuleError):            # already justified staying
        writer.record(root, "drift_warn", {"message": "m4"}, task=t)
    with pytest.raises(writer.RuleError):            # nothing open to answer
        writer.record(root, "drift_reply", {"action": "back"}, task=t)


def test_r34_pause_stops_at_the_click_and_the_reason_is_set_while_it_lasts(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    a, b = add(root), add(root, title="Python exercise")
    with pytest.raises(writer.RuleError):            # nothing to pause before it starts
        writer.record(root, "pause", task=a)
    writer.record(root, "start", task=a)
    clicked = writer.record(root, "pause", task=a)[0]["ts"]
    pause = state.current(root)["tasks"][a]["pauses"][-1]
    assert pause == {"at": clicked, "reason": None}  # stopped at the click, no reason yet
    writer.record(root, "pause_reason", {"reason": "interrupted"}, task=a)
    writer.record(root, "pause_reason", {"reason": "blocked"}, task=a)   # a later pick replaces it
    assert state.current(root)["tasks"][a]["pauses"][-1]["reason"] == "blocked"
    with pytest.raises(events.EventError):           # buttons only: no free text
        writer.record(root, "pause_reason", {"reason": "tired I guess"}, task=a)
    writer.record(root, "start", task=a)             # Resume closes the pause as it is
    with pytest.raises(writer.RuleError):
        writer.record(root, "pause_reason", {"reason": "planned"}, task=a)
    writer.record(root, "start", task=b)             # starting another pauses a: switched
    assert state.current(root)["tasks"][a]["pauses"][-1]["reason"] == "switched"


def test_r34_leaving_saves_the_context_as_its_own_step(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    a = add(root)
    writer.record(root, "start", task=a)
    writer.record(root, "pause", task=a)
    assert state.current(root)["tasks"][a]["notes"] == []   # pausing saves no context
    with pytest.raises(events.EventError):
        writer.record(root, "checkpoint", {"note": "  "}, task=a)
    writer.record(root, "checkpoint", {"note": "did A, stopped at B, next C"}, task=a)
    st = state.current(root)
    assert st["tasks"][a]["notes"] == ["did A, stopped at B, next C"]
    assert st["tasks"][a]["status"] == "paused"


def test_d57_finished_tasks_are_final_until_reopened(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    done_t, dropped_t = add(root), add(root, title="other")
    writer.record(root, "start", task=done_t)
    writer.record(root, "done", {"fields": {}}, task=done_t)
    writer.record(root, "drop", task=dropped_t)
    for t in (done_t, dropped_t):
        for etype, data in (("start", {}), ("done", {"fields": {}}), ("drop", {})):
            with pytest.raises(writer.RuleError):
                writer.record(root, etype, data, task=t)
    with pytest.raises(events.EventError):          # reopening needs a reason
        writer.record(root, "reopen", {}, task=done_t)
    writer.record(root, "reopen", {"why": "pressed done by mistake"}, task=done_t)
    st = state.current(root)
    assert st["tasks"][done_t]["status"] == "pending"
    assert st["tasks"][done_t]["reopened"] == ["pressed done by mistake"]
    with pytest.raises(writer.RuleError):           # only finished tasks reopen
        writer.record(root, "reopen", {"why": "x"}, task=done_t)


def test_d57_done_without_start_is_accepted_and_marked(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root)
    ev_done = writer.record(root, "done", {"fields": {}}, task=t)[-1]
    assert ev_done["data"]["unstarted"] is True
    t2 = add(root, title="started")
    writer.record(root, "start", task=t2)
    assert "unstarted" not in writer.record(root, "done", {"fields": {}}, task=t2)[-1]["data"]


def test_r37_task_card_can_be_edited_but_not_emptied(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root, priority=True)
    writer.record(root, "task_edit", {"changes": {"priority": False, "title": "renamed"}}, task=t)
    card = state.current(root)["tasks"][t]
    assert card["priority"] is False and card["title"] == "renamed"
    for bad in ({"perimeter": ""}, {"status": "done"}, {}):
        with pytest.raises(events.EventError):
            writer.record(root, "task_edit", {"changes": bad}, task=t)


def test_d59_idle_is_a_valid_pause_reason(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root)
    writer.record(root, "start", task=t)
    writer.record(root, "pause", {"reason": "idle"}, task=t)
    assert state.current(root)["tasks"][t]["status"] == "paused"


def test_r39_waiting_is_paused_that_moves_on_and_frees_the_active_slot(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    a, b = add(root), add(root, title="other")
    writer.record(root, "start", task=a)
    writer.record(root, "wait", task=a)
    st = state.current(root)
    assert st["tasks"][a]["status"] == "waiting" and st["active"] is None
    writer.record(root, "start", task=b)           # starting another does not touch the waiting one
    st = state.current(root)
    assert st["active"] == b and st["tasks"][a]["status"] == "waiting"
    with pytest.raises(writer.RuleError):           # a waiting task is not paused, it is waiting
        writer.record(root, "pause", task=a)
    writer.record(root, "start", task=a)           # back to it: b is auto-paused, as always
    st = state.current(root)
    assert st["active"] == a and st["tasks"][b]["status"] == "paused"
    writer.record(root, "wait", task=a)
    writer.record(root, "done", {"fields": {}}, task=a)
    assert state.current(root)["tasks"][a]["status"] == "done"


def test_r38_settings_have_defaults_and_refuse_bad_values(root):
    from routine import config
    assert config.settings(root) == {"idle_pause_minutes": 20}          # no file: defaults
    (root / "config").mkdir(exist_ok=True)
    f = root / "config" / "routine.toml"
    f.write_text("idle_pause_minutes = 0", encoding="utf-8")
    assert config.settings(root)["idle_pause_minutes"] == 0
    for bad in ('idle_pause_minutes = -1', 'idle_pause_minutes = "20"', 'idle_pause = 5'):
        f.write_text(bad, encoding="utf-8")
        with pytest.raises(config.ConfigError):
            config.settings(root)


def test_r40_tasks_remember_the_session_that_works_on_them(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    main, side = add(root), add(root, title="slow side task")
    writer.record(root, "start", task=main, session="s-main")
    writer.record(root, "wait", task=side, session="s-side")      # side task straight from pending
    st = state.current(root)
    assert st["active"] == main                                     # the side task does not steal it
    assert st["tasks"][main]["session"] == "s-main"
    assert st["tasks"][side]["session"] == "s-side" and st["tasks"][side]["status"] == "waiting"
    incomplete = add(root, title="x", perimeter="")
    with pytest.raises(writer.RuleError):
        writer.record(root, "wait", task=incomplete, session="s-other")


def test_r43_ending_a_task_with_an_open_drift_warning_closes_it_as_unanswered(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    t = add(root)
    writer.record(root, "start", task=t)
    writer.record(root, "drift_warn", {"message": "about another project"}, task=t)
    written = writer.record(root, "done", {"fields": {}}, task=t)
    assert [e["type"] for e in written] == ["drift_reply", "done"]
    dr = state.current(root)["drift"][t]
    assert dr["open"] is False and dr["replies"][-1]["action"] == "unanswered"


# The full table of a task's states x buttons (T9). Each cell: the status after the button,
# or None when the writer must refuse. This table IS the specification; change both together.
MATRIX = {
    #            start      pause     wait       done    drop       reopen
    "pending":  ("active", None,     "waiting", "done", "dropped", None),
    "active":   ("active", "paused", "waiting", "done", "dropped", None),
    "paused":   ("active", None,     "waiting", "done", "dropped", None),
    "waiting":  ("active", None,     None,      "done", "dropped", None),
    "done":     (None,     None,     None,      None,   None,      "pending"),
    "dropped":  (None,     None,     None,      None,   None,      "pending"),
}
BUTTONS = {"start": {}, "pause": {}, "wait": {}, "done": {"fields": {}}, "drop": {},
           "reopen": {"why": "test"}}
REACH = {"pending": [], "active": ["start"], "paused": ["start", "pause"],
         "waiting": ["start", "wait"], "done": ["start", "done"], "dropped": ["drop"]}


@pytest.mark.parametrize("status", list(MATRIX))
def test_r44_every_cell_of_the_state_table(tmp_path, monkeypatch, status):
    for button, expected in zip(BUTTONS, MATRIX[status]):
        root = tmp_path / f"{status}-{button}"
        root.mkdir()
        monkeypatch.setenv("ROUTINE_DATA_DIR", str(root))
        writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
        t = add(root)
        for step in REACH[status]:
            writer.record(root, step, BUTTONS[step], task=t)
        assert state.current(root)["tasks"][t]["status"] == status
        if expected is None:
            with pytest.raises((writer.RuleError, events.EventError)):
                writer.record(root, button, BUTTONS[button], task=t)
        else:
            writer.record(root, button, BUTTONS[button], task=t)
            assert state.current(root)["tasks"][t]["status"] == expected, (status, button)


def test_r45_surrounding_conditions(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    a, b = add(root, priority=True), add(root, title="b")
    writer.record(root, "break_start", {"technique": "pomodoro"})       # a break with no task (D66)
    writer.record(root, "start", task=a)                                 # starting ends the break
    assert state.current(root)["break"] is None
    writer.record(root, "task_edit", {"changes": {"priority": True}}, task=b)
    st = state.current(root)
    assert st["tasks"][b]["priority"] is True and st["tasks"][a]["priority"] is False
    writer.record(root, "break_start", {"technique": "pomodoro"})
    writer.record(root, "close_day")                                     # nothing runs overnight
    st = state.current(root)
    assert st["tasks"][a]["status"] == "paused" and st["break"] is None


def test_r46_last_break_end_is_kept_for_the_work_phase(root):
    writer.record(root, "open_day", {"mode": "normal"}, day="2026-10-12")
    assert state.current(root)["last_break_end"] is None
    writer.record(root, "break_start", {"technique": "pomodoro 25/5", "minutes": 5})
    ended = writer.record(root, "break_end", {"phone": False})[-1]["ts"]
    assert state.current(root)["last_break_end"] == ended


def test_r49_work_phase_continues_after_a_short_pause_and_restarts_after_a_long_one():
    def ev(ts, etype, data=None, task="t"):
        return {"v": 1, "ts": f"2026-10-12T{ts}:00+02:00", "day": "2026-10-12", "type": etype,
                "task": task, "data": data or {}}
    base = [ev("09:00", "open_day", {"mode": "normal"}, None),
            ev("09:00", "task_add", {"title": "x", "technique": "pomodoro 25/5"}),
            ev("10:00", "start"), ev("10:19", "pause")]
    short = state.fold(base + [ev("10:21", "start")])["tasks"]["t"]["work_started"]
    assert short == "2026-10-12T10:02:00+02:00"      # 2-minute pause: still minute 19 of 25
    long_ = state.fold(base + [ev("12:30", "start")])["tasks"]["t"]["work_started"]
    assert long_ == "2026-10-12T12:30:00+02:00"      # lunch: a new phase
    none = state.fold(base[:1] + [ev("09:00", "task_add", {"title": "x"}), ev("10:00", "start"),
                                  ev("10:19", "pause"), ev("10:21", "start")])["tasks"]["t"]
    assert none["work_started"] == "2026-10-12T10:02:00+02:00"   # no technique: 5-min rule (D76)
