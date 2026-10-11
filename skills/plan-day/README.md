# The morning (piece P2)

Two parts: a **Windows scheduled task** that prepares the inventory before you arrive, and the
**`morning` skill** that plans the day with you. Requirements R9-R13 and R24 in
[`docs/REQUIREMENTS.md`](../../docs/REQUIREMENTS.md); the inventory format in
[`docs/INTERFACES.md`](../../docs/INTERFACES.md) §6.

| File | What it is |
|---|---|
| `SKILL.md` | the skill: close yesterday → calendar and mail (read-only) → inventory → mode and hours → your priority → task cards |
| `CHECK.md` | the manual check of the skill's behaviour (a skill cannot be unit-tested) |
| `../../routine/inventory.py` | the inventory: `python -m routine inventory` |
| `../../bin/install_windows_task.ps1` | registers the daily task (`-DryRun` shows it without registering) |
| `../../bin/uninstall_windows_task.ps1` | removes it |
| `../../bin/run_inventory.ps1` | what the task runs; one log line per run in `<data>/inventory/task.log` |

## Install

1. **A data folder outside this repository** with `config/channels.toml` (start from
   `examples/data/config/`), and tell the routine where it is: `ROUTINE_DATA_DIR`, or
   `data_dir = "..."` in `routine.local.toml` at the repository root.
2. **Check your channels:** `python -m routine inventory`, then read
   `<data>/inventory/<today>.json`. Every channel should be `ok`; an `error` says why.
3. **The skill**, as a link (not a copy: the skill finds the CLI two folders above itself):

   ```powershell
   New-Item -ItemType Junction -Path "$HOME\.claude\skills\morning" -Target "<repo>\skills\morning"
   ```

   ```bash
   ln -s "<repo>/skills/plan-day" ~/.claude/skills/plan-day
   ```

   If you already have another skill called `morning`, link it under another folder name.
4. **The scheduled task** (Windows), first as a dry run, then for real:

   ```powershell
   powershell -ExecutionPolicy Bypass -File bin\install_windows_task.ps1 -DataDir "<data>" -DryRun
   powershell -ExecutionPolicy Bypass -File bin\install_windows_task.ps1 -DataDir "<data>"
   ```

   It runs every day at 06:00 (`-At` to change it) and at every logon, and a missed run happens
   as soon as the computer is back. Running twice in a day gives the same sheet with fresher
   counts. Remove it with `bin\uninstall_windows_task.ps1`.

## Channels

Every place where work piles up is a channel in `channels.toml`, labelled `source` (read),
`copy` or `dead` (listed, never read). Three generic readers cover markdown ledgers (table
rows, open checkboxes, bullets, headings), JSON or JSON Lines files, and folders of files;
their options are in each reader's docstring in `routine/inventory.py`. A channel that cannot
be read shows as an error, never as an empty list.
