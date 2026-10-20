# routine

**What it is:** A daily routine manager for people who work all day with Claude Code: one task at a
time, ideas go to an inbox, and unfinished work carries over by itself.

**How it works:** A small Python program keeps the day's plan in a folder on your own machine. A plugin for
Claude Code shows the task you're on above the prompt and lets you pause or finish it. Each morning, a
short plan picks the day's one priority.

**Status:** active (reviewed 2026-10-20).

**How to run:** step by step in `docs/MANUAL.md`.

**Notebook:** private, outside this repo. The design is in `docs/DESIGN.md`.

**What it demonstrates:** That a tool can stay small and still lose nothing, with your data never leaving your machine.

A daily routine manager for people who work all day with Claude Code.

**One active task at a time, and nothing gets lost.**

- Every morning: one priority, a few well-defined tasks, nothing ranked for you.
- During the day: a band above the prompt shows the task you are on. Ideas go to an inbox
  without leaving it.
- When a task is done: one row of buttons and a short note.
- Unfinished work carries over by itself. Skipping a day's close loses nothing.

Your data stays on your machine, in a folder outside this repository.

How to install and use it, step by step: [`docs/MANUAL.md`](docs/MANUAL.md).

## Try the writer

```bash
export ROUTINE_DATA_DIR=~/routine-data      # any folder outside this repo
python -m routine open-day --data '{"mode": "normal"}'
python -m routine task-add --data '{"title": "Read chapter 3", "done_when": "notes written", "first_step": "open the book", "perimeter": "questions about the chapter"}'
python -m routine view
```

## License

MIT
