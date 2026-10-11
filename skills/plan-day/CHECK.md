# Manual check of the morning skill (R13)

A skill's behaviour cannot be unit-tested: what it does depends on the model reading
`SKILL.md`. `tests/test_inventory.py::test_r13_skill_text_keeps_the_order_and_the_never_rules`
only checks that the instructions are still written down, in order. **This list checks the
behaviour**, by hand, on a demo data folder. Run it after any change to `SKILL.md`, and write
the date and the result at the end.

## Set-up (demo data, nothing real)

```bash
export ROUTINE_DATA_DIR=/tmp/routine-demo && mkdir -p $ROUTINE_DATA_DIR/config
cp examples/data/config/*.toml $ROUTINE_DATA_DIR/config/
python -m routine open-day --day 2026-10-12 --data '{"mode": "normal"}'
python -m routine task-add --data '{"title": "Read section 3", "done_when": "notes", "first_step": "open the pdf", "perimeter": "the text"}'
python -m routine task-add --data '{"title": "Fix the parser", "done_when": "tests green", "first_step": "run the tests", "perimeter": "the parser"}'
```

Day 2026-10-12 is now open with two unfinished tasks. Start a new session and say "good
morning" (or invoke the skill).

## What must happen, in this order

| # | Check | Pass if |
|---|---|---|
| 1 | Yesterday is closed first | before anything else, it says the day is open and asks about **each** task, one per message (tomorrow / ledger / drop) |
| 2 | The answers are written by the CLI | `python -m routine status` shows 2026-10-12 closed; a dropped task shows `dropped`; nobody edited a file |
| 3 | Calendar before mode | today's events and unanswered mail are shown **before** the mode question |
| 4 | Read-only | Gmail's Sent and Drafts are unchanged; no invitation changed state |
| 5 | A missing connector is said | with a connector off, it says "not consulted", never "no events" |
| 6 | Inventory shown as it comes | channels in the file's order, counts, new items; the example channels pointing to `~/projects/example/...` appear as **could not be read**, not as empty |
| 7 | Mode, then hours | each asked alone, in its own message; then `open-day` carries both |
| 8 | Priority asked, never proposed | ask it "what should my priority be?": it gives facts and hands the choice back, without naming one |
| 9 | Complete cards | each task gets done_when, first_step (≤ 2 min), perimeter, kind, project, asked one field per message; the priority has `"priority": true` |
| 10 | Opportunities not capped | ask for five application tasks on a light day: it adds all five |
| 11 | Two old items offered | it offers the inventory's two `old` items, or says there are none |
| 12 | One question per message | no message in the whole run asks two things |
| 13 | The user's language | answer in Spanish: it continues in Spanish |
| 14 | Ends with the view | it shows `python -m routine view` and how to start a task |

## Log

| Date | Who | Result | Notes |
|---|---|---|---|
| | | not run yet | |
