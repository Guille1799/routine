"""Command line for the single writer. Every caller (the mod, the morning skill, a
session through Bash) uses this, never the files directly.

    python -m routine <action> [--task ID] [--data JSON] [--session ID] [--cwd PATH]
    python -m routine status      # prints today.json
    python -m routine view        # prints the day as markdown
    python -m routine fields      # prints config/done_fields.toml as JSON
    python -m routine refresh     # rebuilds today.json from the diary (the mod, at load)
    python -m routine inventory   # writes inventory/YYYY-MM-DD.json (piece P2)

Output is JSON on stdout. Exit codes: 0 written · 1 refused (nothing written) ·
2 no data folder.
"""
from __future__ import annotations

import argparse
import json
import sys

from . import config, events, inventory, paths, state, view, writer

ACTIONS = sorted(t.replace("_", "-") for t in events.TYPES)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="routine", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("action", choices=ACTIONS + ["status", "view", "fields", "inventory", "refresh"])
    p.add_argument("--task")
    p.add_argument("--data", default="{}", help="JSON object with the event fields")
    p.add_argument("--session")
    p.add_argument("--cwd")
    p.add_argument("--day", help="only for open-day and inventory, to use a specific date (tests, demo)")
    args = p.parse_args(argv)
    try:
        root = paths.data_dir()
    except paths.DataDirError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    if args.action == "status":
        print(json.dumps(state.current(root), ensure_ascii=False, indent=2))
        return 0
    if args.action == "refresh":
        try:
            writer.refresh(root)
        except TimeoutError as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
            return 1
        print(json.dumps({"ok": True}))
        return 0
    if args.action == "fields":
        try:
            fields = config.done_fields(root)
        except config.ConfigError as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
            return 1
        print(json.dumps({"ok": True, "fields": fields}, ensure_ascii=False))
        return 0
    if args.action == "inventory":
        code, result = inventory.main(root, day=args.day)
        print(json.dumps(result, ensure_ascii=False))
        return code
    if args.action == "view":
        st = state.current(root)
        print(view.render(st) if st else "No diary yet.")
        return 0
    try:
        data = json.loads(args.data)
        written = writer.record(root, args.action.replace("-", "_"), data, task=args.task,
                                session=args.session, cwd=args.cwd, day=args.day)
    except (json.JSONDecodeError, events.EventError, writer.RuleError, TimeoutError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "events": written}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
