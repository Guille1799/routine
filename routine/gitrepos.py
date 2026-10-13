"""Commits not pushed, per repository, and pushing one when the user says so (D78).

The question is the one a plain `git push` answers: the commits on the current branch
that its upstream does not have, `git rev-list @{u}..HEAD`. Other local branches are not
counted, because `push` would not send them either.

- A repository whose branch has no upstream (no remote, or a branch never pushed, or a
  detached HEAD) says **"no remote"**, never 0: 0 would read as "nothing to push".
- A git failure (not a repository, missing folder, git not installed) is an **error**,
  never a count.
- No `fetch` is done: the count is against the remote-tracking branch git already has. It
  can count a commit pushed from another machine, never miss one made here.

The repositories are the projects in `projects.toml`, or the `repos` list of a
`git_unpushed` channel. `push` only pushes one of those, runs a plain `git push` (the
repository's own pre-push hooks run as usual and their output is reported) and has no
way to add `--force` or `--no-verify`.
"""
from __future__ import annotations

import os
import subprocess
import tomllib
from pathlib import Path

from . import config

PUSH_TIMEOUT_S = 300


class RepoError(RuntimeError):
    """A repository could not be measured or pushed."""


def configured(root: Path, channel: dict | None = None) -> list[tuple[str, Path]]:
    """The repositories to watch, as (name, folder), in the configured order.

    A `git_unpushed` channel may list them (`repos = ["~/projects/a", ...]`, named by their
    folder); without a list, every project in projects.toml is one, named by its id, so a
    project added there is watched without being written twice.
    """
    if channel is None:
        path = root / "config" / "channels.toml"
        try:
            with path.open("rb") as fh:
                chans = tomllib.load(fh).get("channel", [])
        except (OSError, tomllib.TOMLDecodeError):
            chans = []
        channel = next((c for c in chans if c.get("reader") == "git_unpushed"
                        and c.get("label") == "source"), {})
    if channel.get("repos"):
        paths = [Path(p).expanduser() for p in channel["repos"]]
        return [(p.name, p) for p in paths]
    return [(p["id"], p["path"]) for p in config.projects(root).values()]


def _git(repo: Path, *args: str, timeout: float = 60) -> subprocess.CompletedProcess:
    # Without inherited GIT_* variables: with GIT_DIR set, `-C` no longer decides the repo.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    try:
        return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                              encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL,
                              env=env, timeout=timeout)
    except FileNotFoundError as exc:
        raise RepoError("git is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        raise RepoError(f"git did not answer in {timeout:.0f} s") from exc


def _say(r: subprocess.CompletedProcess) -> str:
    return " ".join((r.stderr or r.stdout or "").split())[:200]


def check(name: str, path: Path) -> dict:
    """One repository: status ok (with `ahead` and its commits), no remote, or error."""
    out = {"repo": name, "path": str(path)}
    if not path.is_dir():
        return {**out, "status": "error", "error": f"not found: {path}"}
    try:
        top = _git(path, "rev-parse", "--show-toplevel")
        if top.returncode != 0:
            return {**out, "status": "error", "error": f"not a git repository: {_say(top)}"}
        branch = _git(path, "symbolic-ref", "--quiet", "--short", "HEAD")
        if branch.returncode != 0:
            return {**out, "status": "no remote", "why": "detached HEAD: no branch to push"}
        out["branch"] = branch.stdout.strip()
        upstream = _git(path, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        if upstream.returncode != 0:
            remotes = _git(path, "remote").stdout.split()
            why = (f"branch {out['branch']} has no upstream" if remotes
                   else "no remote configured")
            return {**out, "status": "no remote", "why": why}
        out["upstream"] = upstream.stdout.strip()
        log = _git(path, "log", "--format=%H%x1f%ad%x1f%s", "--date=short", "@{u}..HEAD")
        if log.returncode != 0:
            return {**out, "status": "error", "error": f"git log failed: {_say(log)}"}
    except RepoError as exc:
        return {**out, "status": "error", "error": str(exc)}
    commits = []
    for line in log.stdout.splitlines():
        sha, day, subject = (line.split("\x1f") + ["", ""])[:3]
        commits.append({"sha": sha, "date": day, "subject": subject})
    return {**out, "status": "ok", "ahead": len(commits), "commits": commits}


def summary(repos: list[dict]) -> str:
    """`routine 0 · app 12 · notes no remote · site error`, in the configured order."""
    words = {"ok": lambda r: str(r["ahead"]), "no remote": lambda r: "no remote",
             "error": lambda r: "error"}
    return " · ".join(f"{r['repo']} {words[r['status']](r)}" for r in repos)


def push(name: str, path: Path) -> dict:
    """`git push` in one configured repository. Nothing else can be added to the command."""
    before = check(name, path)
    if before["status"] != "ok":
        raise RepoError(f"{name}: {before.get('why') or before.get('error')}; nothing pushed")
    r = _git(path, "push", timeout=PUSH_TIMEOUT_S)
    after = check(name, path)
    return {"repo": name, "pushed": r.returncode == 0, "exit": r.returncode,
            "output": "\n".join(s for s in (r.stdout.strip(), r.stderr.strip()) if s),
            "ahead_before": before["ahead"], "ahead_after": after.get("ahead")}
