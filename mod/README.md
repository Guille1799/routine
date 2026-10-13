# The routine mod (P3)

A Claude Code mod that keeps the day's one active task in front of you, in every
session. Requirements R15-R20, R25-R27 and R32 in [`docs/REQUIREMENTS.md`](../docs/REQUIREMENTS.md);
the contracts it relies on in [`docs/INTERFACES.md`](../docs/INTERFACES.md).

## What it does

| Where | What |
|---|---|
| Each session its own task (D64) | A task belongs to the session of its last start or wait. The band, the per-prompt context, the token count, the idle pause and the tool's defaults all follow **this session's** task: active (timer, Pause, Done, Wait), paused (Resume) or waiting as a side task (since when, Done). The day's active task, when it is in another session, is only named, dimmed (`now: T9 elsewhere`). A session with no task says `no task in this session · say 'let's do T#'`. A slow side task starts in its own session straight from pending with `wait` |
| Footer chip | This session's task in a few characters at the right of the prompt footer (`SessionMode`): `T1 ▶ 14m`, `T4 waiting 09:45`, `T1 paused`, `no task here`, `no day open`. Desktop draws it in **every pane** of a split view, where the band shows only in the active pane. On desktop it carries small clickable buttons for that session's task: `pause` (or `resume`) and `recap`. It cannot take the keyboard, so no hotkeys there |
| Session commands | Typed in a pane's prompt, they act on **that session's** task and answer in one line, with no model turn: `/pause [reason]` (e.g. `/pause interrupted`), `/resume`, `/done` (opens the done row), `/wait [T#]` (this task, or start T# here as a side task), `/tasks`. `/recap` is the engine's own and works when you type it; a plugin may not run it |
| Band above the prompt | Two rows. Row 1, where this session is: `2026-10-12 · 2 of 13 done · T3 <task> · Pomodoro · work 19/25` (or `waiting since 09:30`, `paused`, `break 3/5 left`), then the day's active task if it is elsewhere, dimmed. Row 2, what it can do: `[Pause] [Done] [Wait] [Break] [Recap] [Tasks] data 09:41`, every button with its key. Each row fits its own width: in row 1 the other session's task goes first, then the date, then the title is cut with an ellipsis, then the progress; the phase never. In row 2 the data time shortens, then (below about 63 columns) the labels shrink to their key, `[P] [D] [W] [B] [R] [Tasks]`, and only in very narrow panes do Wait, Break and Recap go (they are in the Tasks pane too). `Tasks` always stays. A missing data folder or diary is said there, never thrown |
| Tasks pane | The band's `Tasks` button opens a pane with today's full list: status mark, title, done when, first step, carried counter, and the inbox count. `Start` on pending and paused tasks, `Done` on the active one (the same writer calls and done row as the band), `Reopen` on finished ones, which asks the reason first (D57). `Edit` opens the card in place (title, done when, first step, perimeter) and saves only what changed; `Unset priority` on the day's priority (D61). Rows of this session's tasks say `· here`. A waiting task shows `[w]` and since when, with `Start` to bring it back; active and paused ones offer `Wait` (D62). Break and Recap are here too. The phone, which has no text field, gets no Reopen or Edit |
| No day open today | Once per session per day, the model is told to ask in one line whether to start the day with `/plan-day` (and that it closes an older day still open first). The band says `no day open today · /plan-day`, or `<day> still open · /plan-day` |
| Every prompt | The active task's card, its perimeter and the drift rule go to the model as hidden context, read when the prompt is sent (`prompt.submit`, not the system prompt, so the prompt cache is kept) |
| Tool `routine` | The model calls it when you say "let's do T2", "pause", "done", "reopen T1", "change the first step of T3", "T2 can run on its own" (wait), when a message drifts off the perimeter (warned once), to capture to the inbox, or to keep something you said. "T2" is the 2nd task in today's order |
| Done | One step: one row per configured field (`config/done_fields.toml`) and one note the session drafts and you correct. From chat, the tool asks only for the missing required fields |
| `/inbox <text>` | Captured without a model turn |
| Rhythm and breaks | Each task has a rhythm on its card (D67, D68): `pomodoro 25/5`, `50/10`, `free` (flowtime) or none. While it runs the band names it and shows the phase: `Pomodoro · work 18/25` (`18/25` when narrow), `free · 47m working`; with none, just the time, no timer. When a timed phase ends: one toast and `time for a 5-min break [Start break]`. During the break: `break 3/5 left`; at its end, phone yes / no, then a recap, and a new work phase starts. The phase is the writer's (`work_started`, D73): a pause shorter than the break continues it, a longer one starts a new one. `Break` offers 5, 10, 15 or 20 minutes, the rhythm's own preselected (free: about a fifth of the work). The first start of a task with no rhythm offers the choice in one row, pomodoro suggested; nothing is timed until a pick. The footer chip shows the phase too: `T1 ▶ 18/25`, `T1 ▶ break due`, `T1 break 3/5` |
| Recap | The `Recap` button, and after a break: one question over this session's transcript. Never the built-in `/recap`: the engine refuses it when a plugin runs it |
| Idle pause | After `idle_pause_minutes` (in `<data>/config/routine.toml`, default 20, 0 = off) with no prompt since the end of the session's last answer, no event in the diary and no typing (the prompt box is looked at every minute; a draft that changed is typing, one left as it was is idle), the active task pauses with the reason `idle` (D59). A waiting task is never the active one, so it is never paused; nor during a break |
| Usage | Each turn with an active task logs its token counts against that task |

## Rules it keeps

- **It never writes a file.** Every change is `python -m routine <action>` (the single
  writer, D35). Reads are fresh reads of `<data>/state/today.json`, never cached.
- **Nothing in non-interactive runs.** A session with no surface (`claude -p`, robots)
  gets no tool, no command, no context, and nothing is written. The desktop app attaches
  its surface after the session starts, so the tool is registered on attach.
- `hooks/contract.ts` lists every writer call the mod makes; `tests/test_mod_contract.py`
  replays them through the real CLI.

## Where the band shows

Claude Code Desktop draws one plugin band per window: above the prompt of the **active
pane** only, and only for your own local sessions (checked in the desktop app 2.31226, whose
Code tab mounts the band with `isPanelActive`). In a split view the band follows the
pane you click into; the other panes show none, even though the mod runs in each of them
(tool, context and `/inbox` work everywhere). The terminal draws it in every session.
The footer chip is drawn per pane, so every pane still says its session's task.

## Options

| Option | Default | What |
|---|---|---|
| `dataDir` | the `ROUTINE_DATA_DIR` variable | the private data folder, outside this repository |
| `python` | `python` | the Python that runs the writer |
| `codeDir` | the folder above this mod | where `python -m routine` runs |

## Develop and test

```bash
claude plugin validate mod
```

```bash
claude plugin test mod
```

```bash
python -m pytest -q
```

To try it in a session, load the folder for that session only:

```bash
claude --plugin-dir ./mod
```

In the desktop app, name the folder in `CLAUDE_CODE_PLUGIN_DIRS` (absolute path, in the
`env` block of the user settings) instead, and set `dataDir` in the plugin's options.
