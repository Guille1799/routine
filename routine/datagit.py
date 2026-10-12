"""Commit the day at the close, when the data folder is a git repository (D69).

Only the diary and the state are committed: they are what the writer produces. The
config is the user's own file and is never committed by the routine. A data folder that
is not a git repository is fine: the close says it skipped the commit, and why.
A failed commit never undoes the close: the day is already written; the output says what
went wrong.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

COMMITTED = ("diary", "state/today.json")


def _git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)


def commit_day(root: Path, day: str) -> dict:
    try:
        top = _git(root, "rev-parse", "--show-toplevel")
    except OSError:
        return {"committed": False, "why": "git is not installed"}
    if top.returncode != 0 or Path(top.stdout.strip()).resolve() != root.resolve():
        return {"committed": False, "why": "the data folder is not a git repository"}
    present = [p for p in COMMITTED if (root / p).exists()]
    if not present:
        return {"committed": False, "why": "no diary or state to commit"}
    add = _git(root, "add", "--", *present)
    if add.returncode != 0:
        return {"committed": False, "why": f"git add failed: {add.stderr.strip()}"}
    if _git(root, "diff", "--cached", "--quiet", "--", *present).returncode == 0:
        return {"committed": False, "why": "nothing changed since the last commit"}
    message = f"routine: day {day} closed"
    done = _git(root, "commit", "-m", message, "--", *present)
    if done.returncode != 0:
        return {"committed": False, "why": f"git commit failed: {(done.stderr or done.stdout).strip()}"}
    sha = _git(root, "rev-parse", "--short", "HEAD").stdout.strip()
    return {"committed": True, "commit": sha, "message": message, "paths": present}

