"""Commits not pushed, per repository, and pushing one on the user's yes (R50, D78)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from routine import gitrepos, inventory

REPO = Path(__file__).resolve().parent.parent


def git(cwd: Path, *args: str) -> str:
    out = subprocess.run(["git", "-c", "user.name=test", "-c", "user.email=test@example.com",
                          *args], cwd=cwd, capture_output=True, text=True, check=True,
                         stdin=subprocess.DEVNULL)
    return out.stdout.strip()


def commit(repo: Path, n: int) -> None:
    for i in range(n):
        f = repo / f"f{len(list(repo.glob('f*')))}.txt"
        f.write_text(str(i), encoding="utf-8")
        git(repo, "add", f.name)
        git(repo, "commit", "-q", "-m", f"change {f.stem}")


def pushed_repo(tmp: Path, name: str, ahead: int) -> Path:
    """A repository pushed to a bare remote, then `ahead` commits more."""
    remote = tmp / f"{name}.git"
    git(tmp, "init", "-q", "--bare", "-b", "main", str(remote))
    repo = tmp / name
    git(tmp, "init", "-q", "-b", "main", str(repo))
    git(repo, "config", "core.hooksPath", str(tmp / f"{name}-hooks"))  # no hooks but the test's
    commit(repo, 1)
    git(repo, "remote", "add", "origin", str(remote))
    git(repo, "push", "-q", "-u", "origin", "main")
    commit(repo, ahead)
    return repo


def local_repo(tmp: Path, name: str) -> Path:
    repo = tmp / name
    git(tmp, "init", "-q", "-b", "main", str(repo))
    commit(repo, 3)
    return repo


@pytest.fixture()
def root(tmp_path, monkeypatch):
    data = tmp_path / "routine-data"
    (data / "config").mkdir(parents=True)
    monkeypatch.setenv("ROUTINE_DATA_DIR", str(data))
    return data


def projects(root: Path, repos: dict[str, Path]) -> None:
    body = "".join(f'[[project]]\nid = "{n}"\npath = "{str(p).replace(chr(92), "/")}"\n\n'
                   for n, p in repos.items())
    (root / "config" / "projects.toml").write_text(body, encoding="utf-8")


def channels(root: Path, extra: str = "") -> None:
    (root / "config" / "channels.toml").write_text(
        '[[channel]]\nid = "unpushed"\ntitle = "Commits not pushed"\nlabel = "source"\n'
        f'reader = "git_unpushed"\n{extra}\n', encoding="utf-8")


def cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "routine", *args], cwd=REPO, capture_output=True,
                          text=True, encoding="utf-8", stdin=subprocess.DEVNULL)


# ---------------------------------------------------------------- counting

def test_r50_commits_not_pushed_are_counted_and_no_remote_is_never_zero(tmp_path):
    two = pushed_repo(tmp_path, "app", 2)
    clean = pushed_repo(tmp_path, "site", 0)
    alone = local_repo(tmp_path, "notes")
    unpushed_branch = pushed_repo(tmp_path, "lib", 0)
    git(unpushed_branch, "checkout", "-q", "-b", "feature")
    plain = tmp_path / "plain"
    plain.mkdir()

    app = gitrepos.check("app", two)
    assert app["status"] == "ok" and app["ahead"] == 2
    assert [c["subject"] for c in app["commits"]] == ["change f2", "change f1"]
    assert gitrepos.check("site", clean)["ahead"] == 0
    notes = gitrepos.check("notes", alone)
    assert notes["status"] == "no remote" and "ahead" not in notes
    assert notes["why"] == "no remote configured"
    lib = gitrepos.check("lib", unpushed_branch)
    assert lib["status"] == "no remote" and lib["why"] == "branch feature has no upstream"
    assert gitrepos.check("plain", plain)["status"] == "error"
    assert gitrepos.check("gone", tmp_path / "gone")["status"] == "error"
    assert gitrepos.summary([app, gitrepos.check("site", clean), notes]) == \
        "app 2 · site 0 · notes no remote"


def test_r50_the_morning_channel_counts_per_repo_and_reports_a_broken_one(root, tmp_path):
    app, alone = pushed_repo(tmp_path, "app", 2), local_repo(tmp_path, "notes")
    projects(root, {"app": app, "notes": alone})
    channels(root)                                # no `repos`: every project in projects.toml
    chan = inventory.build(root, day="2026-10-13")["channels"][0]
    assert chan["status"] == "ok" and chan["count"] == 2
    assert chan["summary"] == "app 2 · notes no remote"
    assert [r["status"] for r in chan["repos"]] == ["ok", "no remote"]

    commit(app, 1)
    chan = inventory.build(root, day="2026-10-14")["channels"][0]
    assert chan["count"] == 3 and [i["title"] for i in chan["new"]] == ["app: change f3"]

    plain = tmp_path / "plain"
    plain.mkdir()
    channels(root, f'repos = ["{str(app).replace(chr(92), "/")}", "{str(plain).replace(chr(92), "/")}"]')
    chan = inventory.build(root, day="2026-10-15")["channels"][0]
    assert chan["status"] == "error" and chan["count"] is None and chan["new"] is None
    assert "plain" in chan["error"] and chan["summary"] == "app 3 · plain error"


# ---------------------------------------------------------------- the CLI

def test_r50_cli_lists_and_pushes_only_the_named_repo(root, tmp_path):
    app, site = pushed_repo(tmp_path, "app", 2), pushed_repo(tmp_path, "site", 1)
    alone = local_repo(tmp_path, "notes")
    projects(root, {"app": app, "site": site, "notes": alone})

    listed = cli("unpushed")
    assert listed.returncode == 0
    assert json.loads(listed.stdout)["summary"] == "app 2 · site 1 · notes no remote"

    done = cli("push", "--data", '{"repo": "app"}')
    out = json.loads(done.stdout)
    assert done.returncode == 0 and out["pushed"] is True
    assert (out["ahead_before"], out["ahead_after"]) == (2, 0)
    assert gitrepos.check("site", site)["ahead"] == 1        # the others are untouched

    for data, why in (('{"repo": "app", "force": true}', "exactly"),
                      ('{"repo": "nope"}', "unknown repository"),
                      ('{"repo": "notes"}', "no remote configured")):
        refused = cli("push", "--data", data)
        assert refused.returncode == 1 and why in json.loads(refused.stdout)["error"], data


def test_r50_a_pre_push_hook_runs_and_its_refusal_is_reported(root, tmp_path):
    app = pushed_repo(tmp_path, "app", 1)
    hooks = tmp_path / "app-hooks"
    hooks.mkdir()
    hook = hooks / "pre-push"
    hook.write_text("#!/bin/sh\necho 'guard: personal path found' >&2\nexit 1\n", encoding="utf-8")
    hook.chmod(0o755)
    projects(root, {"app": app})
    refused = cli("push", "--data", '{"repo": "app"}')
    out = json.loads(refused.stdout)
    assert refused.returncode == 1 and out["pushed"] is False
    assert "guard: personal path found" in out["output"]
    assert out["ahead_after"] == 1                           # nothing went through
