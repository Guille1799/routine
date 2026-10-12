# The routine mod (P3)

A Claude Code mod that keeps the day's one active task in front of you, in every
session. Requirements R15-R20, R25-R27 and R32 in [`docs/REQUIREMENTS.md`](../docs/REQUIREMENTS.md);
the contracts it relies on in [`docs/INTERFACES.md`](../docs/INTERFACES.md).

## What it does

| Where | What |
|---|---|
| Band above the prompt | `date · n of m done · T2 <task> · 41m · [Pause] [Done] [Break] [Recap] [Tasks] · data 09:41`. The last part is the time of the data it read (`last_ts`). A missing data folder or diary is said there, never thrown. Items sit a gap apart, and the line fits its pane: below 100 columns the date goes and the progress and time shorten (`1/3`, `09:41`); below 72 Recap and the progress go and Break shows only once it is due; below 48 Tasks goes too. The task, its timer, Pause and Done always stay |
| Tasks pane | The band's `Tasks` button opens a pane with today's full list: status mark, title, done when, first step, carried counter, and the inbox count. `Start` on pending and paused tasks, `Done` on the active one (the same writer calls and done row as the band), `Reopen` on finished ones, which asks the reason first (D57). `Edit` opens the card in place (title, done when, first step, perimeter) and saves only what changed; `Unset priority` on the day's priority (D61). Break and Recap are here too. The phone, which has no text field, gets no Reopen or Edit |
| No day open today | Once per session per day, the model is told to ask in one line whether to start the day with `/plan-day` (and that it closes an older day still open first). The band says `no day open today · /plan-day`, or `<day> still open · /plan-day` |
| Every prompt | The active task's card, its perimeter and the drift rule go to the model as hidden context, read when the prompt is sent (`prompt.submit`, not the system prompt, so the prompt cache is kept) |
| Tool `routine` | The model calls it when you say "let's do T2", "pause", "done", "reopen T1", "change the first step of T3", when a message drifts off the perimeter (warned once), to capture to the inbox, or to keep something you said. "T2" is the 2nd task in today's order |
| Done | One step: one row per configured field (`config/done_fields.toml`) and one note the session drafts and you correct. From chat, the tool asks only for the missing required fields |
| `/inbox <text>` | Captured without a model turn |
| Break | Pomodoro by default (5 min after 25 min of work), 15 and 17 min offered. The time left comes from the `break_start` event, so a reload keeps it. At the end, one tap: phone yes / no, then a recap |
| Recap | The `Recap` button, and after a break: one question over this session's transcript. Never the built-in `/recap`: the engine refuses it when a plugin runs it |
| Idle pause | After `idle_pause_minutes` (in `<data>/config/routine.toml`, default 20, 0 = off) with no prompt since the end of the session's last answer and no event in the diary, the active task pauses with the reason `idle` (D59). Never a waiting task, never during a break |
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
