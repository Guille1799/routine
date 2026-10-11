"""The mod (P3) and the writer cannot drift apart.

`mod/hooks/contract.ts` lists, as JSON, one example of every writer call the mod makes.
The mod's own tests (`claude plugin test mod`) prove the mod emits exactly those calls,
with the argv format pinned in `mod/tests/core.test.ts`. This test replays them, in a
day's order, through the real CLI, so a call the writer would refuse fails here.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

from routine import state

REPO = Path(__file__).resolve().parent.parent
CONTRACT = REPO / "mod" / "hooks" / "contract.ts"
# The order a day would see them in; every contract entry must appear here.
SCENARIO = ["start", "drift_warn", "drift_reply", "inbox", "said", "break_start", "break_end",
            "usage", "pause", "start", "done"]


def contract() -> dict:
    text = CONTRACT.read_text(encoding="utf-8")
    m = re.search(r"/\* contract:start \*/(.*)/\* contract:end \*/", text, re.S)
    assert m, "contract markers not found in mod/hooks/contract.ts"
    return json.loads(m.group(1))


def argv(call: dict, task: str) -> list[str]:
    """What mod/hooks/core.ts writerArgv builds (pinned by mod/tests/core.test.ts)."""
    out = [sys.executable, "-m", "routine", call["action"].replace("_", "-")]
    if call.get("task"):
        out += ["--task", task if call["task"] == "$task" else call["task"]]
    out += ["--data", json.dumps(call.get("data", {}), ensure_ascii=False),
            "--session", "session-1", "--cwd", str(REPO)]
    return out


@pytest.fixture()
def data(tmp_path):
    root = tmp_path / "routine-data"
    root.mkdir()
    return root


def run(args: list[str], root: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "ROUTINE_DATA_DIR": str(root), "PYTHONIOENCODING": "utf-8"}
    return subprocess.run(args, cwd=REPO, env=env, capture_output=True, text=True,
                          encoding="utf-8", stdin=subprocess.DEVNULL)


def test_r16_every_call_the_mod_makes_is_written_by_the_real_writer(data):
    calls = contract()
    assert set(SCENARIO) == set(calls), "a contract entry is missing from the scenario"
    base = [sys.executable, "-m", "routine"]
    assert run(base + ["open-day", "--data", '{"mode":"normal"}', "--day", "2026-10-12"],
               data).returncode == 0
    card = {"title": "Read section 3", "done_when": "notes written", "first_step": "open the pdf",
            "perimeter": "questions about the text", "kind": "reading"}
    added = run(base + ["task-add", "--data", json.dumps(card)], data)
    assert added.returncode == 0, added.stdout
    task = json.loads(added.stdout)["events"][0]["task"]

    for name in SCENARIO:
        done = run(argv(calls[name], task), data)
        assert done.returncode == 0, f"{name}: {done.stdout} {done.stderr}"
        st = state.current(data)
        if name == "start":  # the band's elapsed time reads it (R17)
            assert st["tasks"][task]["since"] == json.loads(done.stdout)["events"][-1]["ts"]
        if name == "usage":  # the per-task total (R27)
            u = calls["usage"]["data"]
            assert st["tasks"][task]["tokens"] == {
                "input": u["input_tokens"] + u["cache_read_input_tokens"] + u["cache_creation_input_tokens"],
                "output": u["output_tokens"]}

    st = state.current(data)
    assert st["tasks"][task]["status"] == "done"
    assert st["tasks"][task]["done"] == calls["done"]["data"]["fields"]
    assert st["tasks"][task]["notes"][-1] == calls["done"]["data"]["note"]
    assert st["drift"][task]["warned"] == 1
    assert st["break"] is None
    assert [i["text"] for i in st["inbox"].values()] == ["buy milk"]


def test_r32_the_fields_the_mod_reads_come_from_the_config(data):
    """The mod reads `python -m routine fields` as {"fields": [{id, label, kind, options?,
    required?, prefill?}]} (mod/hooks/core.ts DoneField); the example config must give that."""
    (data / "config").mkdir()
    example = REPO / "examples" / "data" / "config" / "done_fields.toml"
    (data / "config" / "done_fields.toml").write_bytes(example.read_bytes())
    out = run([sys.executable, "-m", "routine", "fields"], data)
    assert out.returncode == 0, out.stdout
    fields = json.loads(out.stdout)["fields"]
    assert [f["id"] for f in fields] == ["rating", "learned_how", "drifted", "phone", "note"]
    for f in fields:
        assert isinstance(f["label"], str) and f["kind"] in ("buttons", "yesno", "text")
    assert fields[-1]["prefill"] == "session"
    # the done call in the contract carries exactly these fields
    assert set(contract()["done"]["data"]["fields"]) == {f["id"] for f in fields}
