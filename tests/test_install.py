"""Install a demo and uninstall it, leaving nothing behind and nothing of the user's
touched (R31)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

from routine import install, state

REPO = Path(__file__).resolve().parent.parent


def test_r31_install_a_demo_and_uninstall_it_leaving_nothing_behind(tmp_path):
    demo = tmp_path / "demo-data"
    out = install.install_demo(demo, day="2026-10-12")
    assert out["ok"] and (demo / install.MARKER).is_file()
    for f in ("channels.toml", "done_fields.toml", "projects.toml"):
        assert (demo / "config" / f).is_file()
    # the demo is a real data folder: the CLI reads it
    env = {**os.environ, "ROUTINE_DATA_DIR": str(demo), "PYTHONIOENCODING": "utf-8"}
    view = subprocess.run([sys.executable, "-m", "routine", "view"], cwd=REPO, env=env,
                          capture_output=True, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)
    assert view.returncode == 0 and "Try the routine" in view.stdout
    assert state.current(demo)["day"] == "2026-10-12"

    mine = tmp_path / "my-data"                      # the user's own folder: no demo mark
    (mine / "diary").mkdir(parents=True)
    (mine / "diary" / "keep.jsonl").write_text("{}\n", encoding="utf-8")
    calls = []
    fake_task = lambda name, dry: calls.append((name, dry)) or {"name": name, "removed": not dry}

    out = install.uninstall(mine, remove_task=fake_task)
    assert "left untouched" in out["data"] and (mine / "diary" / "keep.jsonl").is_file()
    out = install.uninstall(demo, dry_run=True, remove_task=fake_task)
    assert demo.exists() and "would be removed" in out["data"]
    out = install.uninstall(demo, remove_task=fake_task)
    assert not demo.exists()
    assert calls == [("routine-inventory", False), ("routine-inventory", True), ("routine-inventory", False)]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["my-data"]   # nothing else touched


def test_r31_the_demo_goes_outside_the_repo_and_into_an_empty_folder(tmp_path):
    with pytest.raises(install.InstallError, match="outside"):
        install.install_demo(REPO / "demo-inside")
    assert not (REPO / "demo-inside").exists()
    busy = tmp_path / "busy"
    busy.mkdir()
    (busy / "notes.txt").write_text("mine", encoding="utf-8")
    with pytest.raises(install.InstallError, match="not empty"):
        install.install_demo(busy)
    assert [p.name for p in busy.iterdir()] == ["notes.txt"]


@pytest.mark.skipif(os.name != "nt", reason="the scheduled task exists only on Windows")
def test_r31_uninstall_calls_the_real_task_script(tmp_path):
    name = f"routine-test-{uuid.uuid4().hex[:8]}"    # never an existing task; dry run anyway
    out = install.remove_windows_task(name, dry_run=True)
    assert out == {"name": name, "existed": False, "removed": False}
    done = subprocess.run([sys.executable, "-m", "routine.install", "uninstall", "--task-name", name,
                           "--dry-run"], cwd=REPO, capture_output=True, text=True,
                          stdin=subprocess.DEVNULL)
    assert done.returncode == 0 and json.loads(done.stdout)["data"] == "no folder given: no data touched"
