# routine

A daily routine manager for people who work all day with Claude Code.

**One active task at a time, and nothing gets lost.**

- Every morning: one priority, a few well-defined tasks, nothing ranked for you.
- During the day: a band above the prompt shows the task you are on. Ideas go to an inbox
  without leaving it.
- When a task is done: one row of buttons and a short note.
- Unfinished work carries over by itself. Skipping a day's close loses nothing.

Your data stays on your machine, in a folder outside this repository.

> Status: early. Foundations (the single writer) are in place; the morning skill and the
> Claude Code mod are being built. See [`docs/DESIGN.md`](docs/DESIGN.md).

## Try the writer

```bash
export ROUTINE_DATA_DIR=~/routine-data      # any folder outside this repo
python -m routine open-day --data '{"mode": "normal"}'
python -m routine task-add --data '{"title": "Read chapter 3", "done_when": "notes written", "first_step": "open the book", "perimeter": "questions about the chapter"}'
python -m routine view
```

## License

MIT
