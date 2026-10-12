# Interfaces shared by the pieces

The morning piece (P2) and the mod (P3) are built in parallel. They agree on these seven
contracts, fixed by P1. Changing one means changing every piece that uses it, in the same
commit.

## 1 · Data folder

Found by `ROUTINE_DATA_DIR`, or `data_dir` in `routine.local.toml` at the repo root
(git-ignored). Never inside the repo. Missing → the CLI exits 2 and the band says
"no data folder" (R30). The mod may also expose it as a `userConfig` field and pass it to
the CLI through the environment.

```
<data>/
├── config/      channels.toml · projects.toml · done_fields.toml · private_terms.txt
├── diary/       YYYY-MM/YYYY-MM-DD.jsonl   (events, append-only)
├── state/       today.json (read model) · .writer.lock
├── inventory/   YYYY-MM-DD.json            (written by the Windows task, P2)
├── library/     to_read.md · to_watch.md · open_topics.md · ideas.md   (views, P4)
├── holding/     holding.md                 (view: items whose project has no entry command, P4)
└── learning/    learned.jsonl · said.jsonl                    (P4)
```

## 2 · Event schema v1

Defined in `routine/events.py` (the code is the contract; this is a summary).
`{"v":1, "ts":ISO-with-offset, "day":"YYYY-MM-DD", "type":..., "task"?, "session"?, "cwd"?, "data":{...}}`.
Types: `open_day, task_add, task_edit, carry, start, pause, pause_reason, checkpoint, done,
drop, wait, reopen, inbox, inbox_sorted, held_sorted, library_touch, library_decide, said,
exception, drift_warn, drift_reply, break_start, break_end, usage, close_day`.

A sorted item names one **place** (D32): `ledger:<project>` (only with the entry command's
`command` and `exit: 0`), `holding`, or `library:<drawer>` (to_read, to_watch, open_topics,
ideas). `inbox_sorted` and `held_sorted` carry it in `to`; a task sent away is a `drop` with
`sent_to`; a promoted library item is a `library_decide` with `decision: promote` and `to`.
The library and the holding list are folded from every day's diary; their markdown files are
views the writer rewrites.

## 3 · The writer CLI

`python -m routine <action> [--task ID] [--data JSON] [--session ID] [--cwd PATH]`, plus
`status` (today.json) and `view` (markdown). JSON on stdout. Exit codes: **0** written,
**1** refused (rule or schema; nothing written), **2** no data folder. **Nobody writes the
diary any other way**: the mod calls it with `$.process.run`, the skill with Bash.

Piece 4 adds:

- `sort [--task ID] --data '{"item"|"held"|"library": ID, "project"?, "date"?, "drawer"?, "title"?, "what"?}' [--dry-run]`:
  sends one thing to its one place by the purpose rule (D32). A project with an `entry`
  runs it first, outside the lock, and writes the event only on exit 0; a failure writes
  nothing. `--dry-run` prints the place and the exact `command` and writes nothing.
  `inbox-sorted` and `held-sorted` are not actions of their own, and `drop` with `sent_to`
  or `library-decide` with `promote` are refused outside `sort`.
- `library [--day D]`: `{library, holding, offer}`; `offer` is the one item untouched for 5
  weeks this close asks about, or null once a decision was written today (D33).
- `library-touch` / `library-decide` (`keep` | `drop`) on a library item.
- `exception --data '{"for": "YYYY-MM-DD", "why": "..."}'`: a written exception, never ahead.
- `stats [--day D] [--since D]`: the fulfilled-day rate and the list of days (D7, D41, D63).
- `close-day` also returns `git`: the commit of `diary/` and `state/` when the data folder is
  a git repository, or why it was skipped (D69).

`config/projects.toml`: `[[project]]` with `id`, `path` and an optional `entry`, a command
line run in `path` with `{title}`, `{what}`, `{date}` and `{project}` filled in, each as one
argument (no shell). A relative program path is taken inside `path`.

Rules the writer enforces: one open day (D24, D28); automatic carry-over at `open-day`
(D28); one active task, starting another auto-pauses (D10); a task starts only with
`done_when`, `first_step` and `perimeter` (D10, D37); continuing after a drift warning
needs `why` (D9); `said` never stores focus data (D44).

## 4 · Task identity and card

Ids look like `t-20261012-a1b2c3` and **survive carry-over**. "T2" is only a spoken alias:
the position in today's order. Card fields: `title`, `done_when`, `first_step`,
`perimeter`, `kind` (reading | python | application | project | old | other), `project`,
`priority` (true for the day's one priority), and after a pause `last_note`.

## 5 · Read model

`state/today.json` is rewritten by the writer after every event: `day, open, closed, mode,
hours, tasks{id: card+status+carried+notes}, order, active, last_paused, inbox{id: text,
since}, break, drift, tomorrow, last_ts`. Readers never write it. The band shows `last_ts`
(D38). `last_paused` is the task paused last while it stays paused: the band's Resume.

## 6 · Inventory (P2 → morning skill)

```
inventory/YYYY-MM-DD.json:
{"generated": ISO, "day": "YYYY-MM-DD",
 "channels": [{"id", "title", "label": "source", "status": "ok"|"error", "error"?,
               "count", "new": [{"id", "title", "link"?}], "new_total", "baseline"?}],
 "skipped":  [{"id", "title", "label": "copy"|"dead", "why"}],
 "old":      [{"channel", "id", "title", "since": "YYYY-MM-DD"|null, "link"?}]}
```

- No ranking field exists, on purpose (D19).
- A failed channel has `status: "error"` and `count` and `new` set to **null**, never `[]`.
- `new` = items first seen today, cut to `max_new` (default 10) unless the channel is
  `never_capped` (D5); `new_total` always says how many there are.
- `baseline: true` = the channel is read for the first time, so nothing can be called new.
- `old` = the oldest pending items of channels marked `old = true` (D31), two a day, never
  the same one within 7 days.
- Private state in `inventory/seen.json` (first and last day each item was seen; old items
  offered).

## 7 · Naming and language

Everything in English (D36). Commands: `/inbox`, `/done`, `/pause`. Task kinds and modes as
listed above. Config files are TOML.
