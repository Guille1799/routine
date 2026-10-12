"""Install a demo, and uninstall without touching anything of the user's (R31).

    python -m routine.install demo <folder>
    python -m routine.install uninstall [--data-dir <folder>] [--task-name NAME] [--dry-run]

`demo` creates a data folder outside the repository from `examples/data`, with one demo
day written through the real writer, so the routine can be tried without real data. The
folder gets a `.routine-demo` mark.

`uninstall` removes the Windows scheduled task (bin/uninstall_windows_task.ps1) and, when
given a folder carrying the demo mark, that folder. A data folder without the mark is the
user's own and is never removed: uninstalling leaves it exactly as it was (D45, D46).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from . import paths, writer

EXAMPLES = paths.REPO_ROOT / "examples" / "data"
UNINSTALL_TASK = paths.REPO_ROOT / "bin" / "uninstall_windows_task.ps1"
MARKER = ".routine-demo"
DEMO_CARD = {"title": "Try the routine", "done_when": "one task started and finished",
             "first_step": "run: python -m routine view", "perimeter": "this demo folder",
             "kind": "other", "priority": True}


class InstallError(RuntimeError):
    """The install or uninstall cannot go ahead. Nothing was changed."""


def install_demo(target: Path, day: str | None = None) -> dict:
    target = Path(target).expanduser().resolve()
    if target == paths.REPO_ROOT or paths.REPO_ROOT in target.parents:
        raise InstallError("the data folder must live outside the code repository (D46)")
    if target.exists() and any(target.iterdir()):
        raise InstallError(f"{target} is not empty: a demo goes into a new or empty folder")
    shutil.copytree(EXAMPLES, target, dirs_exist_ok=True)
    (target / MARKER).write_text("Created by python -m routine.install demo. "
                                 "Uninstall removes this whole folder.\n", encoding="utf-8")
    day = day or datetime.now().astimezone().date().isoformat()
    writer.record(target, "open_day", {"mode": "normal", "hours": 2}, day=day)
    writer.record(target, "task_add", DEMO_CARD)
    writer.record(target, "inbox", {"text": "an article to read later"})
    return {"ok": True, "data_dir": str(target),
            "next": [f"set ROUTINE_DATA_DIR={target}",
                     "python -m routine view",
                     f"python -m routine.install uninstall --data-dir {target}"]}


def remove_windows_task(task_name: str, dry_run: bool) -> dict:
    if os.name != "nt":
        return {"name": task_name, "skipped": "not Windows: there is no scheduled task"}
    args = ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-File", str(UNINSTALL_TASK), "-TaskName", task_name] + (["-DryRun"] if dry_run else [])
    done = subprocess.run(args, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if done.returncode != 0:
        raise InstallError(f"could not remove the scheduled task: {done.stderr.strip()}")
    return json.loads(done.stdout)


def uninstall(data_dir: Path | None = None, task_name: str = "routine-inventory",
              dry_run: bool = False, remove_task=remove_windows_task) -> dict:
    result = {"ok": True, "dry_run": dry_run, "task": remove_task(task_name, dry_run)}
    if data_dir is None:
        result["data"] = "no folder given: no data touched"
        return result
    folder = Path(data_dir).expanduser().resolve()
    if not (folder / MARKER).is_file():
        result["data"] = f"{folder} is not a demo folder: it is yours and was left untouched"
        return result
    if not dry_run:
        shutil.rmtree(folder)
    result["data"] = f"demo folder {'would be' if dry_run else 'was'} removed: {folder}"
    return result


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m routine.install", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="what", required=True)
    demo = sub.add_parser("demo", help="create a demo data folder outside the repository")
    demo.add_argument("folder")
    demo.add_argument("--day", help="the demo day (default: today)")
    un = sub.add_parser("uninstall", help="remove the scheduled task and a demo folder")
    un.add_argument("--data-dir", help="removed only if it carries the demo mark")
    un.add_argument("--task-name", default="routine-inventory")
    un.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)
    try:
        if args.what == "demo":
            result = install_demo(Path(args.folder), day=args.day)
        else:
            result = uninstall(args.data_dir and Path(args.data_dir), args.task_name, args.dry_run)
    except (InstallError, writer.RuleError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
