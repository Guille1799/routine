"""Command line for the single writer. Every caller (the mod, the morning skill, a
session through Bash) uses this, never the files directly.

    python -m routine <action> [--task ID] [--data JSON] [--session ID] [--cwd PATH]
    python -m routine status      # prints today.json
    python -m routine view        # prints the day as markdown
    python -m routine fields      # prints config/done_fields.toml as JSON
    python -m routine settings    # prints config/routine.toml merged over the defaults
    python -m routine refresh     # rebuilds today.json from the diary (the mod, at load)
    python -m routine inventory   # writes inventory/YYYY-MM-DD.json (piece P2)
    python -m routine sort        # sends an item to its one place (D27, D32, D34); --dry-run first
    python -m routine library     # the library, the holding list and this close's expired item (D33)
    python -m routine stats       # the fulfilled-day rate and the list of days (D7, D41, D63)

close-day also commits diary/ and state/ when the data folder is a git repository (D69).

Output is JSON on stdout. Exit codes: 0 written · 1 refused (nothing written) ·
2 no data folder.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime

from . import config, datagit, events, inventory, library, paths, sorting, state, stats, view, writer

# Written only by `sort`, which runs the entry command first: a raw call could claim an item
# reached a ledger without anything having run (D27).
SORT_ONLY = {"inbox_sorted", "held_sorted"}
ACTIONS = sorted(t.replace("_", "-") for t in events.TYPES if t not in SORT_ONLY)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="routine", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("action", choices=ACTIONS + ["status", "view", "fields", "settings", "inventory", "refresh",
                                           "sort", "library", "stats"])
    p.add_argument("--task")
    p.add_argument("--data", default="{}", help="JSON object with the event fields")
    p.add_argument("--session")
    p.add_argument("--cwd")
    p.add_argument("--day", help="only for open-day, inventory, library and stats: the date to use "
                                 "as today (tests, demo)")
    p.add_argument("--since", help="stats: count from this day instead of the first day in the diary")
    p.add_argument("--dry-run", action="store_true",
                   help="sort: show where the item would go and the exact command; write nothing")
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
    if args.action == "settings":
        try:
            values = config.settings(root)
        except config.ConfigError as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
            return 1
        print(json.dumps({"ok": True, "settings": values}, ensure_ascii=False))
        return 0
    if args.action == "inventory":
        code, result = inventory.main(root, day=args.day)
        print(json.dumps(result, ensure_ascii=False))
        return code
    if args.action in ("sort", "library", "stats"):
        try:
            if args.action == "sort":
                result = {"ok": True, **sorting.run(root, json.loads(args.data), task=args.task,
                                                    dry_run=args.dry_run, session=args.session,
                                                    cwd=args.cwd)}
            elif args.action == "library":
                st = state.current(root)
                today = args.day or (st["day"] if st else _today())
                result = {"ok": True, **library.current(root), "offer": library.offer(root, today)}
            else:
                result = stats.compute(root, args.day or _today(), since=args.since)
        except (json.JSONDecodeError, sorting.SortError, config.ConfigError, events.EventError,
                writer.RuleError, TimeoutError) as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
            return 1
        print(json.dumps(result, ensure_ascii=False))
        return 0
    if args.action == "view":
        st = state.current(root)
        print(view.render(st) if st else "No diary yet.")
        return 0
    try:
        data = json.loads(args.data)
        if (args.action == "drop" and isinstance(data, dict) and "sent_to" in data) or                 (args.action == "library-decide" and isinstance(data, dict) and data.get("decision") == "promote"):
            raise writer.RuleError("sending a task or promoting a library item goes through sort, "
                                   "which runs the project's entry command first")
        written = writer.record(root, args.action.replace("-", "_"), data, task=args.task,
                                session=args.session, cwd=args.cwd, day=args.day)
    except (json.JSONDecodeError, events.EventError, writer.RuleError, TimeoutError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    result = {"ok": True, "events": written}
    if args.action == "close-day":  # the day is written; now keep it safe (D69)
        result["git"] = datagit.commit_day(root, written[-1]["day"])
    print(json.dumps(result, ensure_ascii=False))
    return 0


def _today() -> str:
    return datetime.now().astimezone().date().isoformat()


if __name__ == "__main__":
    sys.exit(main())
