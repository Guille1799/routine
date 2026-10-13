"""The mod in the real engine, driven as Claude Desktop drives it.

Each test starts the Claude Code binary headless (`-p`, stream-json, `--await-initialize`),
loads the mod from this repository, and talks to it the way the desktop app does: it asks
for the band, the footer chip and the Tasks pane (`ui_render`), presses their buttons
(`ui_press`), types into their fields (`ui_input`), and types slash commands. What it reads
back is the tree the desktop would draw; what the mod wrote lands in a throwaway data folder.

Nothing here touches the user's own setup: the binary runs with an empty config directory
of its own (no settings, hooks or plugins of the user's), a throwaway data folder, and no
model turn (no prompt reaches a model). Time is set by writing the diary's events with
timestamps in the past, so a phase "19 minutes in" is 19 minutes in for the engine's clock.

The binary is CLAUDE_BIN, or the newest Claude Desktop build under %APPDATA%; without one
these tests are skipped, never passed.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from routine import state

REPO = Path(__file__).resolve().parent.parent
MOD = REPO / "mod"
BAND_PROPS = {"hasSurvey": False, "isWorking": False, "maxRows": 12, "bodyColumns": 120,
              "scroll": {"bodyRows": 11, "offset": 0}, "view": {}}
PANE_PROPS = {"title": "Today", "isFocused": False, "bodyColumns": 100, "placement": "dock",
              "scroll": {"bodyRows": 30, "offset": 0}, "view": {}}
CARD = {"done_when": "it is written", "first_step": "open it", "perimeter": "this text only",
        "kind": "other"}


def claude_binary() -> str | None:
    if os.environ.get("CLAUDE_BIN"):
        return os.environ["CLAUDE_BIN"]
    appdata = os.environ.get("APPDATA")
    if appdata:
        builds = sorted(Path(appdata, "Claude", "claude-code").glob("*/*/claude.exe"),
                        key=lambda p: [int(x) for x in p.parent.parent.name.split(".") if x.isdigit()])
        if builds:
            return str(builds[-1])
    return None


BINARY = claude_binary()
pytestmark = pytest.mark.skipif(BINARY is None, reason="no Claude Code binary: set CLAUDE_BIN")


# ---------------------------------------------------------------- the day, written by hand

def iso(minutes_ago: float) -> str:
    return (datetime.now().astimezone() - timedelta(minutes=minutes_ago)).isoformat(timespec="seconds")


class Day:
    """A throwaway day: the diary written event by event, with chosen timestamps."""

    def __init__(self, root: Path, session: str):
        self.root, self.session = root, session
        self.day = datetime.now().astimezone().date().isoformat()
        self.events: list[dict] = []
        self.event("open_day", 240, {"mode": "normal"})

    def event(self, etype: str, minutes_ago: float, data: dict | None = None, task: str | None = None,
              mine: bool = False) -> None:
        e = {"v": 1, "ts": iso(minutes_ago), "day": self.day, "type": etype, "data": data or {}}
        if task:
            e["task"] = task
        if mine:
            e["session"] = self.session
        self.events.append(e)

    def task(self, tid: str, title: str, minutes_ago: float = 200, **card) -> str:
        self.event("task_add", minutes_ago, {"title": title, **CARD, **card}, task=tid)
        return tid

    def write(self) -> None:
        diary = self.root / "diary" / self.day[:7] / f"{self.day}.jsonl"
        diary.parent.mkdir(parents=True, exist_ok=True)
        diary.write_text("\n".join(json.dumps(e, ensure_ascii=False) for e in self.events) + "\n",
                         encoding="utf-8")
        state.write_snapshot(self.root, state.current(self.root))

    def today(self) -> dict:
        return state.current(self.root)


# ---------------------------------------------------------------- the desktop, faked

class Desktop:
    """One headless session of the real binary, spoken to as the desktop app speaks to it."""

    def __init__(self, data: Path, home: Path, session: str):
        env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE")}
        env.update({
            "CLAUDE_CONFIG_DIR": str(home),           # none of the user's settings, hooks or plugins
            "CLAUDE_CODE_PLUGIN_DIRS": str(MOD),       # the mod of this checkout
            "ROUTINE_DATA_DIR": str(data),             # the throwaway day
            "PYTHONIOENCODING": "utf-8",
        })
        args = [BINARY, "-p", "--input-format", "stream-json", "--output-format", "stream-json",
                "--verbose", "--await-initialize", "--session-id", session]
        self.proc = subprocess.Popen(args, cwd=str(home), env=env, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True, encoding="utf-8")
        self.inbox: queue.Queue = queue.Queue()
        self.logs: list[str] = []
        self.n = 0
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=lambda: [None for _ in self.proc.stderr], daemon=True).start()
        self.request({"subtype": "initialize"})

    def _read(self) -> None:
        for line in self.proc.stdout:
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get("type") == "system" and m.get("subtype") == "ui_log":
                self.logs.append(m.get("text", ""))
            self.inbox.put(m)

    def send(self, message: dict) -> None:
        self.proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def request(self, req: dict, timeout: float = 30) -> dict:
        self.n += 1
        rid = f"r{self.n}"
        self.send({"type": "control_request", "request_id": rid, "request": req})
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                m = self.inbox.get(timeout=0.5)
            except queue.Empty:
                continue
            if m.get("type") == "control_response":
                r = m.get("response", {})
                if r.get("request_id") == rid:
                    assert r.get("subtype") != "error", r
                    return r.get("response", r)
        raise TimeoutError(f"no answer to {req.get('subtype')}")

    def render(self, component: str, instance: str, props: dict) -> dict:
        return self.request({"subtype": "ui_render", "surface": "desktop", "client_id": "smoke",
                             "component": component, "instance_id": instance, "props": props})["tree"]

    def band(self, columns: int = 120) -> dict:
        return self.render("AbovePrompt", "above-prompt", {**BAND_PROPS, "bodyColumns": columns})

    def chip(self) -> dict:
        return self.render("SessionMode", "session-mode", {"modes": []})

    def pane(self) -> dict:
        return self.render("Pane", "routine-tasks", PANE_PROPS)

    def press(self, tree: dict, key: str) -> dict:
        el = find(tree, key)
        assert el is not None, f"no {key} in {text(tree)}"
        return self.request({"subtype": "ui_press", "plugin": el["press"]["plugin"],
                             "handle": el["press"]["handle"], "key": key, "surface": "desktop"})

    def type(self, tree: dict, key: str, value: str, component: str, instance: str) -> dict:
        el = find(tree, key)
        assert el is not None, f"no field {key} in {text(tree)}"
        return self.request({"subtype": "ui_input", "plugin": el["press"]["plugin"],
                             "handle": el["press"]["handle"], "kind": "submit", "value": value,
                             "key": key, "component": component, "instance_id": instance})

    def command(self, line: str, timeout: float = 30) -> None:
        """A slash command typed in the prompt; the mod answers it with no model turn."""
        self.send({"type": "user", "message": {"role": "user", "content": line}})
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                m = self.inbox.get(timeout=0.5)
            except queue.Empty:
                continue
            if m.get("type") == "result":
                usage = m.get("usage") or {}
                assert not usage.get("output_tokens"), f"{line} reached a model: {usage}"
                return
        raise TimeoutError(f"{line} gave no result")

    def close(self) -> None:
        self.proc.kill()


def find(tree, key: str):
    if isinstance(tree, dict):
        if (tree.get("props") or {}).get("key") == key:
            return tree
        for c in tree.get("children") or []:
            hit = find(c, key)
            if hit is not None:
                return hit
    return None


def text(tree) -> str:
    """What the tree shows: its strings and button labels, a space apart."""
    if isinstance(tree, str):
        return tree
    if not isinstance(tree, dict):
        return ""
    label = (tree.get("props") or {}).get("label")
    parts = [f"[{label}]"] if label else []
    parts += [text(c) for c in tree.get("children") or []]
    return " ".join(p for p in parts if p).replace("  ", " ")


@pytest.fixture()
def world(tmp_path):
    """A throwaway data folder, an empty config home, and this session's id."""
    data, home = tmp_path / "routine-data", tmp_path / "home"
    data.mkdir()
    home.mkdir()
    session = str(uuid.uuid4())
    clients: list[Desktop] = []

    def open_desktop() -> Desktop:
        d = Desktop(data, home, session)
        clients.append(d)
        return d

    yield Day(data, session), open_desktop
    for d in clients:
        d.close()


def eventually(check, timeout: float = 10.0):
    """The band is redrawn after the writer answers: read until the check holds."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = check()
        if last:
            return last
        time.sleep(0.3)
    return last


# ---------------------------------------------------------------- 3 · rhythm

def test_smoke_3_a_task_with_no_rhythm_asks_to_pick_one_and_then_shows_the_phase(world):
    day, desktop = world
    t = day.task("t-1", "Write the intro")
    day.event("start", 7, task=t, mine=True)
    day.write()
    d = desktop()
    band = d.band()
    shown = text(band)
    assert "Rhythm for T1? pick one: [pomodoro 25/5] [50/10] [free] [no timer]" in shown
    assert all((find(band, f"technique-{n}")["props"].get("variant") is None) for n in range(4))
    d.press(band, "technique-0")
    assert day.today()["tasks"][t]["technique"] == "pomodoro 25/5"
    shown = eventually(lambda: (lambda s: s if "Pomodoro · work 7/25" in s else None)(text(d.band())))
    assert shown and "pick one" not in shown
    assert "T1 ▶ 7/25" in text(d.chip())


# ---------------------------------------------------------------- 4 · short and long pauses

def test_smoke_4_a_short_pause_keeps_the_phase(world):
    day, desktop = world
    short = day.task("t-1", "Short pause", technique="pomodoro 25/5")
    day.event("start", 20, task=short, mine=True)
    day.event("pause", 8, task=short)       # 12 minutes worked, then 2 minutes away
    day.event("start", 6, task=short, mine=True)
    day.write()
    d = desktop()
    assert "Pomodoro · work 18/25" in text(d.band())   # 12 + 6: the phase went on
    assert "T1 \u25b6 18/25" in text(d.chip())
    d.close()


def test_smoke_4b_a_pause_as_long_as_the_break_starts_a_new_phase(world):
    day, desktop = world
    long = day.task("t-1", "Long pause", technique="pomodoro 25/5")
    day.event("start", 60, task=long, mine=True)
    day.event("pause", 40, task=long)              # 20 minutes worked, then lunch
    day.event("start", 5, task=long, mine=True)    # 35 minutes away: a new phase
    day.write()
    d = desktop()
    assert "T1 Long pause · Pomodoro · work 5/25" in text(d.band())


# ---------------------------------------------------------------- 5 · breaks

def test_smoke_5_breaks_of_5_10_15_20_and_the_phone_question_at_the_end(world):
    day, desktop = world
    t = day.task("t-1", "Write the intro", technique="pomodoro 25/5")
    day.event("start", 26, task=t, mine=True)
    day.write()
    d = desktop()
    band = d.band()
    assert "time for a 5-min break [Start break]" in text(band)
    d.press(band, "start-break")
    brk = day.today()["break"]
    assert brk["minutes"] == 5 and brk["technique"] == "pomodoro 25/5"
    assert eventually(lambda: "break 5/5 left" in text(d.band()) or "break 4/5 left" in text(d.band()))
    assert eventually(lambda: "T1 break" in text(d.chip()))
    d.close()

    # The picker: 5, 10, 15 or 20 minutes, the rhythm's own preselected.
    day.event("break_end", 1, {"phone": False})
    day.write()
    d = desktop()
    d.press(d.band(), "break")
    band = d.band()
    assert "Break: [5 min] [10 min] [15 min] [20 min]" in text(band)
    assert find(band, "break-0")["props"].get("variant") == "primary"
    d.press(band, "break-3")
    assert day.today()["break"]["minutes"] == 20
    d.close()

    # At the end: phone yes or no, one tap; then this session's own recap.
    day.event("break_start", 6, {"technique": "pomodoro 25/5", "minutes": 5})
    day.write()
    d = desktop()
    band = d.band()
    assert "Break over. Phone during the break? [Yes] [No]" in text(band)
    d.press(band, "phone-no")
    assert day.today()["break"] is None
    assert eventually(lambda: any(l.startswith("Recap:") for l in d.logs))


# ---------------------------------------------------------------- 6 · the Tasks pane

def test_smoke_6_the_tasks_pane_starts_reopens_edits_and_unsets_the_priority(world):
    day, desktop = world
    a = day.task("t-1", "The priority", priority=True, technique="none")
    b = day.task("t-2", "Next one")
    c = day.task("t-3", "Already done")
    day.event("start", 50, task=c, mine=True)   # the diary in time order: T3 first, then T1
    day.event("done", 40, {"fields": {"rating": "😐"}}, task=c)
    day.event("start", 10, task=a, mine=True)
    day.write()
    d = desktop()
    pane = d.pane()
    shown = text(pane)
    assert "[>] T1 \u2605 The priority · here" in shown
    assert "[ ] T2 Next one" in shown and "[x] T3 Already done" in shown

    d.press(pane, "unprioritize-t-1")
    assert day.today()["tasks"][a]["priority"] is False

    d.press(d.pane(), "edit-t-2")
    pane = eventually(lambda: (lambda p: p if find(p, "edit-first_step-t-2") else None)(d.pane()))
    d.type(pane, "edit-first_step-t-2", "open the pdf at 3.3", "Pane", "routine-tasks")
    d.press(d.pane(), "edit-save-t-2")
    assert day.today()["tasks"][b]["first_step"] == "open the pdf at 3.3"

    d.press(d.pane(), "reopen-t-3")
    asking = eventually(lambda: (lambda p: p if find(p, "reopen-why-t-3") else None)(d.pane()))
    d.type(asking, "reopen-why-t-3", "one more check", "Pane", "routine-tasks")
    assert day.today()["tasks"][c]["status"] == "pending"
    assert day.today()["tasks"][c]["reopened"] == ["one more check"]

    d.press(d.pane(), "start-t-2")
    now = day.today()
    assert now["active"] == b and now["tasks"][a]["status"] == "paused"


# ---------------------------------------------------------------- 7 · /inbox and /drop

def test_smoke_7_inbox_and_drop_from_the_prompt_without_a_model_turn(world):
    day, desktop = world
    t = day.task("t-1", "Write the intro")
    other = day.task("t-2", "Not needed")
    day.event("start", 5, task=t, mine=True)
    day.write()
    d = desktop()
    d.band()  # the desktop draws the band first: that is when the mod's commands are there
    d.command("/inbox call the bank")
    assert [i["text"] for i in day.today()["inbox"].values()] == ["call the bank"]
    d.command("/drop T2 not needed after all")
    dropped = day.today()["tasks"][other]
    assert dropped["status"] == "dropped" and dropped["notes"][-1] == "not needed after all"
    assert day.today()["tasks"][t]["status"] == "active"


# ---------------------------------------------------------------- 8 · recap

def test_smoke_8_the_recap_button_asks_this_session_never_the_engines_recap(world):
    day, desktop = world
    t = day.task("t-1", "Write the intro")
    day.event("start", 5, task=t, mine=True)
    day.write()
    d = desktop()
    d.press(d.band(), "recap")
    # A session with no turn yet has nothing to fork: the mod's own recap says so.
    assert eventually(lambda: "Recap: nothing to recap yet in this session." in d.logs)
