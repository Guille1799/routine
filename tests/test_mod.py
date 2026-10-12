"""The mod's requirements, proven by its own tests (`claude plugin test mod`).

The mod is TypeScript and runs inside Claude Code, so its tests run under the Claude Code
binary. Each mod test is named after the requirement it proves ("R15: ..."); this file
runs them once and holds each requirement to at least one passing test and no failing
one, so the traceability table can name a Python test per requirement.

The binary is `claude` on PATH, or the one named by CLAUDE_BIN. Without it these tests
are skipped, never passed.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from functools import cache
from pathlib import Path

import pytest

MOD = Path(__file__).resolve().parent.parent / "mod"
LINE = re.compile(r"^\((pass|fail)\) (.+?)(?: \[[\d.]+m?s\])?$")


@cache
def results() -> dict[str, str]:
    binary = os.environ.get("CLAUDE_BIN") or shutil.which("claude")
    if not binary:
        pytest.skip("no Claude Code binary: set CLAUDE_BIN or put claude on PATH")
    out = subprocess.run([binary, "plugin", "test", str(MOD)], capture_output=True, text=True,
                         encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL, timeout=300)
    found = {}
    for line in (out.stdout + out.stderr).splitlines():
        m = LINE.match(line.strip())
        if m:
            found[m.group(2)] = m.group(1)
    assert found, f"no test results in the output:\n{out.stdout}\n{out.stderr}"
    if out.returncode != 0:
        assert any(v == "fail" for v in found.values()), f"plugin test failed to run:\n{out.stdout}\n{out.stderr}"
    return found


def proven(req: str) -> None:
    mine = {name: r for name, r in results().items()
            if req in re.split(r"/", name.split(":", 1)[0])}
    assert mine, f"no mod test is named after {req}"
    failed = [name for name, r in mine.items() if r != "pass"]
    assert not failed, f"{req} failing: {failed}"


def test_mod_suite_is_green():
    failed = [name for name, r in results().items() if r != "pass"]
    assert not failed, failed


def test_r15_task_context_only_in_interactive_sessions():
    proven("R15")


def test_r16_start_pause_done_from_any_chat():
    proven("R16")


def test_r17_band_task_time_buttons_and_data_time():
    proven("R17")


def test_r18_drift_warned_once_and_reply_logged():
    proven("R18")


def test_r19_done_in_one_step_missing_fields_asked():
    proven("R19")


def test_r20_inbox_without_a_model_turn():
    proven("R20")


def test_r25_breaks_logged_and_timer_survives_reload():
    proven("R25")


def test_r26_recap_on_demand_and_after_a_break():
    proven("R26")


def test_r27_usage_logged_per_turn_with_active_task():
    proven("R27")


def test_r32_done_fields_from_config():
    proven("R32")


def test_r34_pause_at_the_click_reason_and_leaving():
    proven("R34")


def test_r36_ask_to_start_the_day_once_per_session_per_day():
    proven("R36")


def test_r38_idle_pause_after_configured_minutes():
    proven("R38")
