# Manual

How to use the routine, from install to the end of a day. It describes what the code does
today. `tests/test_manual.py` fails if a CLI action or option, an install command, a tool
action, a slash command, a done field kind or a setting exists in the code but not here, so this file cannot silently fall
behind (D71).

## What the routine is

A daily routine for people who work all day with Claude Code across many sessions. The idea
fits in one line: **one active task at a time, and nothing gets lost.** In the morning you
pick one priority and a few tasks, each with a card that says when it is done and what its
first step is. During the day a band above the prompt shows the task you are on, with
buttons to pause, finish or take a break. Ideas go to an inbox without leaving the task.
Whatever you do not finish moves to the next day by itself.

Four pieces work together:

| Piece | What it is | Where |
|---|---|---|
| The writer | a command line, `python -m routine`, the only thing that writes your diary. It also sorts items at the close, keeps the library and computes the day rate | `routine/` |
| The morning skill | `/plan-day`: plans the day with you, one question at a time | `skills/plan-day/` |
| The inventory task | a Windows scheduled task that prepares the morning sheet | `bin/` |
| The mod | the band, the footer chip, the Tasks pane, the `routine` tool and the slash commands inside Claude Code | `mod/` |

## Install

You need Python 3.11 or newer and Claude Code.

**Try it first with a demo.** This makes a new data folder outside the repository, copies
the example configuration into it, and writes one demo day through the real writer:

```bash
python -m routine.install demo ~/routine-demo
```

Point `ROUTINE_DATA_DIR` at it and run `python -m routine view`. To remove it:

```bash
python -m routine.install uninstall --data-dir ~/routine-demo --dry-run
```

Without `--dry-run`, `uninstall` removes the folder only if it carries the demo mark
(`.routine-demo`); your own data folder is never removed. **It also removes the
`routine-inventory` scheduled task** (`--task-name` names another one), so after a demo on a
machine where you use the routine for real, register the task again. Look at the dry run first.

| Command | Options |
|---|---|
| `demo <folder>` | `--day`: the date of the demo day (default today). The folder must be new or empty |
| `uninstall` | `--data-dir`: the demo folder to remove · `--task-name`: the scheduled task (default `routine-inventory`) · `--dry-run`: say what would go, remove nothing |

For real use:

1. **Make a data folder outside this repository**, for example `~/routine-data`. The writer
   refuses a data folder inside the repository.
2. **Tell the routine where it is**, in one of two ways:
   - the environment variable `ROUTINE_DATA_DIR`, or
   - a file `routine.local.toml` at the repository root (git-ignored) with
     `data_dir = "~/routine-data"`. A relative path there is read from the repository root.
3. **Copy the example configuration** into `<data>/config/`:

   ```bash
   mkdir -p ~/routine-data/config && cp examples/data/config/*.toml ~/routine-data/config/
   ```

   Then edit `channels.toml` so it points at your own lists (see [Channels](#channels-channelstoml)),
   and `projects.toml` with your projects (see [Projects](#projects-projectstoml)).
   Optional: make the data folder a git repository (`git init`) and every close commits the
   day there (see [The close](#the-close-sorting-library-and-the-day-rate)).
4. **Link the morning skill** into your skills folder. Link, do not copy: the skill finds the
   CLI two folders above itself.

   ```bash
   ln -s "<repo>/skills/plan-day" ~/.claude/skills/plan-day
   ```

   On Windows: `New-Item -ItemType Junction -Path "$HOME\.claude\skills\plan-day" -Target "<repo>\skills\plan-day"`.
5. **Register the inventory task** (Windows). Try it as a dry run first:

   ```powershell
   powershell -ExecutionPolicy Bypass -File bin\install_windows_task.ps1 -DataDir "<data>" -DryRun
   ```

   Without `-DryRun` it registers `routine-inventory`: every day at 06:00 (change it with
   `-At`) and at every logon, as you, without admin rights. A run missed while the computer
   was off happens when it is back. Each run appends one line to `<data>/inventory/task.log`.
   `bin\uninstall_windows_task.ps1` removes it and leaves your data alone.
6. **Load the mod.** For one session: `claude --plugin-dir ./mod`. In the desktop app, put
   the absolute path of `mod` in `CLAUDE_CODE_PLUGIN_DIRS` (in the `env` block of your user
   settings). The mod has three options:

   | Option | Default | What |
   |---|---|---|
   | `dataDir` | the `ROUTINE_DATA_DIR` variable | your data folder |
   | `python` | `python` | the Python that runs the writer |
   | `codeDir` | the folder above `mod/` | where `python -m routine` runs |

Check it works: `python -m routine status` prints `null` before your first day, and exit
code 2 means the data folder was not found.

## A day, from morning to close

1. **Morning.** Say "good morning" or type `/plan-day`. The skill:
   - closes yesterday if it is still open (unfinished tasks go to tomorrow unless you name
     some to drop or move to a project ledger);
   - shows today's calendar and unanswered mail, read-only;
   - runs the inventory and shows one count per channel, with only the new items listed,
     plus two old items it offers you;
   - asks what kind of day it is (full, normal, light or bad) and how many hours you have;
   - asks for **the one priority**, and never proposes one;
   - writes each task with its card, one field per question.

   If you skip it, the first prompt of the day in each session asks once whether to start
   the day with `/plan-day`.
2. **Start a task.** In any session say "let's do T1". `T1` is the first task in today's
   order. The model calls the `routine` tool, the task becomes active in that session, and
   the band shows it. Starting a task pauses whatever other task was active.
3. **Work.** The band shows the task, its rhythm (for example `Pomodoro · work 18/25`) and
   its buttons. Every prompt carries the task card to the model, so it can tell you when a
   message drifts off the task. Type `/inbox <idea>` to park an idea.
4. **Breaks.** When a timed phase ends you get a toast and a `Start break` button; or press
   `Break` any time. At the end of the break the band asks whether you used the phone, then
   shows a recap of where you were.
5. **Pause.** `Pause` (or `/pause`) stops the task at the click. A row asks why; the pick is
   optional. `Resume` starts it again. After 20 idle minutes the active task pauses by itself.
6. **Done.** `Done` (or `/done`, or "done" in chat) opens the done row: a few buttons and a
   note the session drafts for you. Correct it and press `Save done`.
7. **Close.** Send each inbox item and each unfinished task you do not want tomorrow to its
   one place with `sort` (try `--dry-run` first), then close the day:

   ```bash
   python -m routine close-day --data '{"tomorrow": "finish the parser"}'
   ```

   Or just type `/close <tomorrow's thing>` (or say "close the day"): it closes the day, and
   what you did not sort carries to tomorrow, where `/plan-day` sorts it. If you do not close,
   the next morning `/plan-day` closes the day for you. Closing pauses
   the active task, ends a running break and, when the data folder is a git repository,
   commits the day. Unfinished tasks and inbox items move to the next day when it opens, with
   the same id and a counter of how many days they carried. Skipping the close loses nothing.
   See [The close](#the-close-sorting-library-and-the-day-rate).

## The CLI

Every change goes through one command line, the single writer. The mod, the skill and you
all use it; nobody edits the diary by hand.

```
python -m routine <action> [--task ID] [--data JSON] [--session ID] [--cwd PATH] [--day YYYY-MM-DD] [--since YYYY-MM-DD] [--dry-run]
```

| Option | What |
|---|---|
| `--data` | a JSON object with the action's fields (default `{}`) |
| `--task` | the task's stable id (`t-20261012-a1b2c3`). `T2` works in chat, not here |
| `--session` | which session wrote it; the mod fills it in |
| `--cwd` | the folder that session works in; the mod fills it in |
| `--day` | for `open-day`, `inventory`, `library` and `stats`: the date to use as today (tests, demos) |
| `--since` | for `stats`: count from this day instead of the first day in the diary |
| `--dry-run` | for `sort`: show where the item would go and the exact command; write nothing |
| `--help` | the list of actions and options |

The answer is JSON on stdout. **Exit codes:** `0` written · `1` refused, nothing written
(the error says why) · `2` no data folder.

### Reading

| Action | What it does | Example |
|---|---|---|
| `status` | prints today's state (`state/today.json`) | `python -m routine status` |
| `view` | prints the day as a markdown sheet | `python -m routine view` |
| `fields` | prints the done fields from `done_fields.toml` as JSON | `python -m routine fields` |
| `settings` | prints `routine.toml` merged over the defaults | `python -m routine settings` |
| `refresh` | rebuilds `today.json` from the diary; writes no event (the mod runs it at load) | `python -m routine refresh` |
| `inventory` | reads every channel and writes `inventory/YYYY-MM-DD.json` | `python -m routine inventory` |

In `view` each task has a mark: `[ ]` pending, `[>]` active, `[~]` paused, `[…]` waiting,
`[x]` done, `[-]` dropped.

### The day

| Action | What it does | Example |
|---|---|---|
| `open-day` | opens today; refused while another day is open. Carries over unfinished tasks and inbox items | `python -m routine open-day --data '{"mode": "normal", "hours": 4, "when": "10:00-14:00"}'` |
| `close-day` | closes the day; pauses the active task, ends a break, and commits the day when the data folder is a git repository (the answer's `git` says what happened) | `python -m routine close-day --data '{"tomorrow": "finish the parser"}'` |
| `carry` | one unfinished task moved into the new day, with its card and a counter | never typed: `open-day` writes it |

### Tasks

| Action | What it does | Example |
|---|---|---|
| `task-add` | adds a task with its card; the answer gives its new id. Add `"priority": true` for the day's one priority (it replaces the old one) | `python -m routine task-add --data '{"title": "Notes on section 3", "done_when": "a page of notes", "first_step": "open the pdf at section 3", "perimeter": "questions about the text", "kind": "reading"}'` |
| `task-edit` | changes card fields: `title`, `done_when`, `first_step`, `perimeter`, `kind`, `project`, `priority`, `technique`. The three start fields cannot be emptied | `python -m routine task-edit --task t-20261012-a1b2c3 --data '{"changes": {"first_step": "open the pdf at 3.3"}}'` |
| `start` | makes the task active. Refused if `done_when`, `first_step` or `perimeter` is missing, or if the task is finished | `python -m routine start --task t-20261012-a1b2c3` |
| `pause` | pauses the active task. Optional `reason` and `note` | `python -m routine pause --task t-20261012-a1b2c3` |
| `pause-reason` | gives the open pause its reason: `planned`, `interrupted`, `blocked`, `switched`, `low energy`, `lost focus` or `other` | `python -m routine pause-reason --task t-20261012-a1b2c3 --data '{"reason": "interrupted"}'` |
| `checkpoint` | a note for whoever picks the task up: what was done, where it stopped, the next step | `python -m routine checkpoint --task t-20261012-a1b2c3 --data '{"note": "read 3.1; stopped at 3.2; next: the figure"}'` |
| `wait` | a session works on the task alone: it leaves the active slot free and is never auto-paused. Works from pending, active or paused | `python -m routine wait --task t-20261012-a1b2c3` |
| `done` | finishes the task with the done fields and the note. A task never started is marked `unstarted` | `python -m routine done --task t-20261012-a1b2c3 --data '{"fields": {"rating": "🔥", "drifted": false, "note": "notes written"}, "note": "notes written"}'` |
| `drop` | gives the task up. Optional `note`; a priority dropped with a note makes the day a justified exception. Sending a task to a ledger is `sort`, not `drop` | `python -m routine drop --task t-20261012-a1b2c3 --data '{"note": "not needed after all"}'` |
| `reopen` | brings a done or dropped task back to pending; needs `why` | `python -m routine reopen --task t-20261012-a1b2c3 --data '{"why": "one more check"}'` |

Done and dropped are final: `start`, `done` and `drop` on them are refused until `reopen`.
The CLI does not check the done fields against `done_fields.toml`; the mod does.

### Capture and focus

| Action | What it does | Example |
|---|---|---|
| `inbox` | captures an idea | `python -m routine inbox --data '{"text": "buy milk"}'` |
| `said` | keeps something you said, for reuse later. `kind` is free, but `drift_reply`, `mode` and `attention` are refused: focus data is never kept as reusable text | `python -m routine said --data '{"text": "this clicked for me", "kind": "reaction"}'` |
| `drift-warn` | logs a warning that a message left the task's perimeter. One per episode | `python -m routine drift-warn --task t-20261012-a1b2c3 --data '{"message": "asked about the weekend"}'` |
| `drift-reply` | the answer: `back`, or `continue` with `why` | `python -m routine drift-reply --task t-20261012-a1b2c3 --data '{"action": "continue", "why": "it is related after all"}'` |
| `break-start` | starts a break: `technique`, and `minutes` (the mod assumes 5 when missing) | `python -m routine break-start --data '{"technique": "pomodoro 25/5", "minutes": 5}'` |
| `break-end` | ends it; `phone` says whether you used it | `python -m routine break-end --data '{"phone": false}'` |
| `usage` | token counts of one turn, added to the task's total | `python -m routine usage --task t-20261012-a1b2c3 --data '{"input_tokens": 120, "output_tokens": 40}'` |

`drift-warn`, `drift-reply`, `break-start`, `break-end` and `usage` are normally written by
the mod; you rarely type them.

### The close, the library and the rate

| Action | What it does | Example |
|---|---|---|
| `sort` | sends one inbox item, unfinished task, held item or library item to its one place (see [The close](#the-close-sorting-library-and-the-day-rate)) | `python -m routine sort --data '{"item": "i-df8d44fd", "drawer": "to_read"}' --dry-run` |
| `library` | prints the library, the holding list, and `offer`: the one item untouched for 5 weeks this close asks about | `python -m routine library` |
| `library-touch` | you used a library item: its 5 weeks start again | `python -m routine library-touch --data '{"item": "i-df8d44fd"}'` |
| `library-decide` | the decision on an expired item: `keep` or `drop` (`promote` goes through `sort`) | `python -m routine library-decide --data '{"item": "i-df8d44fd", "decision": "keep"}'` |
| `exception` | a written exception for a day, today or earlier: the day leaves the rate | `python -m routine exception --data '{"for": "2026-10-10", "why": "travelling"}'` |
| `stats` | the fulfilled-day rate and the list of days | `python -m routine stats --since 2026-10-01` |

`sort` writes the events `inbox_sorted` (an inbox item), `held_sorted` (a held item sent on),
`drop` with `sent_to` (a task) or `library_decide` with `promote`. They are not actions of
their own: only `sort` runs the project's entry command first, so only `sort` may write them.

## The band

The band sits above the prompt, in two rows. It shows **this session's** task, never another
session's.

```
2026-10-12 · 1 of 4 done · T2 Notes on section 3 · Pomodoro · work 18/25
[Pause] [Done] [Wait] [Break] [Recap] [Tasks]  data 09:41
```

**Row 1, where this session is:**

- the date and the progress (`1 of 4 done`; dropped tasks do not count);
- the task as `T2 <title>`, or `no task in this session`;
- the phase in words: `Pomodoro · work 18/25`, `free · 47m working`, just `47m` with no timer,
  `time for a 5-min break`, `break 3/5 left`, `Break over. Phone during the break?`, `paused`,
  `waiting since 09:45`, or `say 'let's do T#'`;
- `now: T9 <title> elsewhere`, dimmed, when the day's active task belongs to another session.

**Row 2, what it can do:** the buttons, each with its key, and `data 09:41`: the time of the
last event the band read, so you know how fresh it is.

### Buttons and hotkeys

| Button | Key | Shown when | What it does |
|---|---|---|---|
| `Resume` | `s` | this session's task is paused | starts it again |
| `Pause` | `p` | the task is active | pauses at the click, then asks why |
| `Done` | `d` | the task is active or waiting | opens the done row |
| `Wait` | `w` | the task is active | lets this session work on it alone |
| `Break` | `b` | no break is due | opens the break picker |
| `Recap` | `r` | always, outside a break | a short recap of this session: where you were, next step |
| `Tasks` | `t` | always | opens the Tasks pane |
| `Start break` | | a timed work phase is over | starts the break the rhythm suggests |
| `End break` | | during a break | ends it early |
| `Yes` / `No` | | the break is over | answers "Phone during the break?", then a recap |

Each row fits its own width. In row 1 the other session's task goes first, then the date,
then the title is cut with an ellipsis, then the progress; the phase never goes. In row 2 the
data time shortens, then in narrow panes the labels shrink to their key (`[P] [D] [W]`), and
only in very narrow panes do `Wait`, `Break` and `Recap` go (they are in the Tasks pane too).
`Tasks` always stays.

### Rows that open under the band

- **Why?** after a pause: `planned`, `interrupted`, `blocked`, `switched`, `low energy`,
  `lost focus`, `other`. A pick is saved at once and closes the row. No pick means no reason.
- **Break:** `5 min`, `10 min`, `15 min`, `20 min`, with the rhythm's own length preselected.
- **Rhythm for T2:** the first time a task runs with no rhythm: `pomodoro 25/5`, `50/10`,
  `free`, `no timer`. Nothing is timed until you pick.
- **The done row:** see [The done row](#the-done-row-done_fieldstoml).

### Where the band shows

In the terminal, in every session. In the desktop app, only above the prompt of the active
pane of a window; in a split view, the other panes have no band, but the footer chip, the
tool and the commands still work there.

When no day is open the band says `no day open today · /plan-day`; when an older day is still
open, `<day> still open · /plan-day`; when the day is closed, `day closed`. A missing data
folder or diary is said there too.

## The footer chip

A short label at the right of the prompt footer, in every pane, with this session's task:

| Chip | Meaning |
|---|---|
| `T1 ▶ 18/25` | active, timed rhythm, minutes worked of the phase |
| `T1 ▶ 47m` | active, `free` rhythm or no timer: minutes worked |
| `T1 ▶ break due` | the work phase is over |
| `T1 break 3/5` | on a break |
| `T4 waiting 09:45` | waiting since 09:45 |
| `T1 paused` | paused |
| `no task here` | this session has no task |
| `no day open` | no day is open |

On desktop the chip also has small `pause` (or `resume`) and `recap` buttons for this
session's task. They have no hotkeys.

## The Tasks pane

`Tasks` on the band, or `/tasks`, opens a pane with the whole day. The head line shows the
date, the progress, the inbox count and the data time, with `Break` and `Recap`. Each task
shows its mark (`[w]` is waiting), `T#`, a ★ on the priority, `carried 2x` when it
carried, `· here` when it belongs to this session, and its done-when and first step.

| Button | On | What it does |
|---|---|---|
| `Start` | pending, paused or waiting tasks (day open) | starts it in this session |
| `Done` | the active task | opens the done row |
| `Wait` | active or paused tasks | lets it run on its own |
| `Edit` | unfinished tasks | edits title, done when, first step and perimeter in place; `Save` writes only what changed |
| `Unset priority` | the priority | removes the ★ |
| `Reopen` | done or dropped tasks (day open) | asks "Why reopen?", then brings it back to pending |

On the phone there is no text field, so `Edit` and `Reopen` are not offered.

## The routine tool (what you say in chat)

The model calls the `routine` tool when you speak about your tasks. You never name the tool;
you just say what you want. A task with no name means this session's task.

| Action | Say something like | What happens |
|---|---|---|
| `start` | "let's do T2" | starts T2 here and gives the model its card and last note. You must name the task |
| `pause` | "pause", "pause, I was interrupted" | pauses at once and writes no note, like the button (D72); a reason only if you said one |
| `wait` | "T2 can run on its own" | the task waits: this session works on it alone |
| `done` | "done" | finishes the task; the model drafts the note and asks only for missing required fields |
| `drop` | "drop T4, not needed after all" | gives the task up (this session's, or the one named); your reason becomes its note |
| `reopen` | "reopen T1, I need one more check" | reopens it; the model asks why if you did not say |
| `edit` | "change the first step of T3 to ...", "use 50/10 for T3" | edits the card (`title`, `done_when`, `first_step`, `perimeter`, `kind`, `project`, `priority`, `technique`) |
| `drift_warn` | (the model, when a message leaves the perimeter) | logs one warning and asks: back to the task, or continue and why? |
| `drift_reply` | "back" / "continue, because ..." | logs your answer |
| `inbox` | "put 'call the bank' in the inbox" | captures it |
| `said` | (the model, to keep a reaction, answer, thought or statement of yours) | keeps it for reuse |
| `status` | "what are today's tasks?" | lists today's tasks with their marks |
| `close` | "close the day; tomorrow I finish the parser" | closes the day with tomorrow's thing; the day is committed when the data folder is a git repository. Unsorted inbox items and unfinished tasks carry to tomorrow, where `/plan-day` sorts them |

The tool and the context work only in interactive sessions. In `claude -p` runs and robots
the mod does nothing and writes nothing.

## Slash commands

They act on **this session's** task and answer in one line, without a model turn.

| Command | What it does |
|---|---|
| `/inbox <text>` | captures an idea to the inbox |
| `/pause [reason]` | pauses this session's task; with a reason (`/pause interrupted`) it saves it too |
| `/resume` | resumes this session's paused or waiting task |
| `/done` | opens the done row above the prompt |
| `/wait [T#]` | this session's task waits; with `T#`, that task starts here as a side task |
| `/tasks` | opens the Tasks pane |
| `/drop [T#] [reason]` | gives up this session's task, or the one named (`/drop T4 not needed`); the reason becomes its note |
| `/close [tomorrow's thing]` | closes the day (`/close finish the parser`); answers whether the day was committed |
| `/plan-day` | the morning skill (not part of the mod) |

`/recap` is Claude Code's own command; you can type it, but the band's `Recap` button uses its
own question instead.

## The close: sorting, library and the day rate

### Sorting: one place per item

At the close each inbox item, and each unfinished task you do not want tomorrow, goes to
**one** place. `sort` decides by the purpose rule:

| You give | It is | It goes to |
|---|---|---|
| a `project` that has an `entry` command | a task | that project's ledger: `sort` runs the entry command, and writes only if it exits 0 |
| a `project` with no `entry` | a task | the **holding list**, dated, until the project has one |
| a `date` and no project | a task | the holding list (there is no ledger to send it to) |
| a `drawer`, and no project or date (inbox items only) | content | the **library**: `to_read`, `to_watch`, `open_topics` or `ideas` |

What you sort is one of: `"item"` (an inbox item id), `--task` (an unfinished task, which
leaves the day as dropped, with where it went), `"held"` (a held item) or `"library"` (a
library item being promoted). `title` and `what` fill the entry command; they default to the
item's text.

```bash
python -m routine sort --task t-20261012-a1b2c3 --data '{"project": "thesis"}' --dry-run
```

**Always try `--dry-run` first**: it prints the place and, for a ledger, the exact `command`,
and writes nothing. Then run the same line without it. A command that fails writes nothing
and the item stays where it was. A project's entry command is never run directly: `sort`
runs it and records the result. The morning skill does the same when you move one of
yesterday's tasks to a ledger.

### The holding list

Items with a purpose whose project has no entry command yet. They stay there, dated, in
`<data>/holding/holding.md`. Once the project has an `entry`, send each one on:

```bash
python -m routine sort --data '{"held": "t-20261012-a1b2c3", "project": "thesis"}'
```

### The library

Content without a purpose, in four drawers, viewed in `<data>/library/`. Each item keeps the
day it came in and the day it was last touched (`library-touch`). An item untouched for **5
weeks** asks for a decision, **one per close**: `python -m routine library` shows it as
`offer`. Answer with `library-decide` (`keep` restarts its 5 weeks, `drop` removes it), or
promote it with `sort` and a project or date:

```bash
python -m routine sort --data '{"library": "i-df8d44fd", "project": "thesis"}'
```

### The day commit

When the data folder is a git repository, `close-day` commits `diary/` and
`state/today.json` there with the message `routine: day <date> closed`. It never commits
`config/`. When the folder is not a repository, or nothing changed, the answer's `git` says
it skipped and why. A failed commit never undoes the close.

### The day rate

A day is **fulfilled** when its priority is done and the day is closed. The routine works if
**75 %** of counted days are fulfilled.

```bash
python -m routine stats
```

- Counted days are every calendar day from the first day in the diary (or `--since`) to
  today. Today shows as `in progress` until it is closed.
- A day not opened, not closed, with no priority, or with the priority not done counts as
  **not fulfilled**.
- A **justified exception** leaves the rate, neither fulfilled nor failed: a day whose
  priority was dropped with a reason (`drop` with a note), or a day with a written
  `exception`. A priority sent to a ledger or the holding list was postponed, not an
  exception.

The answer has the counts, the rate, a one-line `summary` and every day with its result and
why.

## Breaks and techniques

Each task can have a **rhythm** on its card (`technique`):

| Technique | Work | Break |
|---|---|---|
| `pomodoro 25/5` (suggested) | 25 min | 5 min |
| `50/10` | 50 min | 10 min |
| `free` (flowtime) | as long as you like | about a fifth of the work, rounded to 5, 10, 15 or 20 |
| `none` (`no timer`) | no timer | whenever you want |

Any `work/rest` pair such as `40/8` also works through `task-edit`. The work phase starts at
the later of the task's start and the last break's end, so a reload or another session shows
the same numbers. When a timed phase ends you get one toast and a `Start break` button. When
the break is over you get a toast, the band asks about the phone, and a recap follows.

A break can start with no task running. Starting a task ends a running break.

## Drift warnings

Each task's **perimeter** says what counts as related, for example "questions about the
text, unknown terms, links to my project". While a task is active, every prompt carries the
perimeter to the model. If a message falls outside it, the model says so in one line and
logs a warning. Then:

- "back" closes the warning;
- "continue" needs your reason, and no new warning comes for that task;
- after "back", a later drift can be warned again;
- pausing, waiting, finishing or dropping the task with a warning open closes it as
  `unanswered`.

Zero warnings means "not measured", not "no drift".

## The done row (done_fields.toml)

The done row is built from `<data>/config/done_fields.toml`, not from the code. Add, remove
or reorder fields freely. Each `[[field]]` has:

| Key | What |
|---|---|
| `id` | unique name, used in the diary |
| `label` | what the row shows |
| `kind` | one of the kinds below |
| `options` | for `buttons`: the choices |
| `required` | `true`: done is not saved without it |
| `prefill` | `"session"` on a text field: the session drafts it for you |

| Kind | Shows |
|---|---|
| `buttons` | one button per option; pick one |
| `yesno` | `yes` and `no` |
| `text` | a text field; the first text field is also the task's closing note |

Example:

```toml
[[field]]
id = "rating"
label = "How was it?"
kind = "buttons"
options = ["🔥", "😐", "🥱"]
required = true

[[field]]
id = "note"
label = "Done / stopped at / next / I take away"
kind = "text"
prefill = "session"
required = true
```

Check the file with `python -m routine fields`: exit code 1 says what is wrong.

## Settings (routine.toml)

`<data>/config/routine.toml` is optional. A missing file means the defaults; an unknown key
is refused.

| Setting | Default | What |
|---|---|---|
| `idle_pause_minutes` | `20` | minutes with no prompt, no answer and no diary event before the active task pauses with the reason `idle`. `0` turns it off |

```toml
idle_pause_minutes = 30
```

Check it with `python -m routine settings`. If the file cannot be read, the mod never pauses
anyone.

## Channels (channels.toml)

A channel is any place where work for you piles up: a project ledger, a queue file, a folder
of findings, the alerts of another tool. The morning inventory reads them from
`<data>/config/channels.toml` and shows one count per channel, listing only the items that
are new since the last sheet. It never ranks them.

```toml
[[channel]]
id = "ledger"
title = "Project ledger"
label = "source"
why = "the only list of the project's open tasks"
reader = "markdown_rows"
item = "table"
pending = "⬜"
path = "~/projects/example/TODO.md"
old = true
```

- `label`: `source` is read; `copy` and `dead` are listed and never read.
- `reader`: `markdown_rows` (table rows, open checkboxes, bullets or headings), `json_items`
  (a JSON or JSON Lines file) or `file_count` (one item per file in a folder). Each reader's
  options are in its docstring in `routine/inventory.py`; `examples/data/config/channels.toml`
  uses most of them.
- `never_capped = true` shows every new item (opportunities); otherwise at most `max_new`
  (10).
- `old = true` lets the channel's oldest items be offered as the two old items of the day.
- A channel that cannot be read shows as an error, never as an empty list.

## Projects (projects.toml)

`<data>/config/projects.toml` lists your projects and how to add an item to each one's
ledger:

```toml
[[project]]
id = "example"
path = "~/projects/example"
entry = "python bin/add.py {title} --what {what}"
```

- `entry` is optional. A project without one is not a valid destination: its items go to the
  holding list.
- `entry` may use `{title}`, `{what}`, `{date}` and `{project}`; anything else in braces is
  refused when the file is read. Each value becomes one argument; there is no shell.
- The command runs in `path`. A relative program path (`bin/add.py`) is taken inside `path`.

## Where your data lives

Everything is in your data folder, outside the repository:

```
<data>/
├── config/     channels.toml · projects.toml · done_fields.toml · routine.toml · private_terms.txt
├── diary/      YYYY-MM/YYYY-MM-DD.jsonl   one event per line, append-only: the only truth
├── state/      today.json (rebuilt after every write) · .writer.lock
├── inventory/  YYYY-MM-DD.json · seen.json · task.log
├── library/    to_read.md · to_watch.md · open_topics.md · ideas.md   (views)
└── holding/    holding.md                                            (view)
```

The diary is the source; `today.json`, `view`, the library and the holding list are computed
from it. Never edit the views by hand: the writer rewrites them.

**What is never public.** The code is meant to be public; your data never enters it:

- the data folder must live outside the repository, or every command refuses to run;
- `routine.local.toml`, which may name your folder, is git-ignored;
- `tests/test_public_repo.py` fails if a committed file contains a personal path, or any term
  listed in your `config/private_terms.txt` (one term per line; that list stays private too);
- focus data (drift answers, mode, attention) is never stored as reusable `said` text.

## Not built yet

- A guided close: no close button or command in the mod and no close skill. You sort and
  close with the CLI, or ask a session to; `/plan-day` closes a forgotten day the next morning.
- A check that the product text is all in English.

## Keeping this manual current

`tests/test_manual.py` reads the lists from the code (the writer's actions, options and
event types, the install commands, the mod's tool actions and slash commands, the done field
kinds, the settings) and fails if one is missing here. When you add one, add it to this manual in the same commit.
