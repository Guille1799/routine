# Design — current state

A daily routine manager for people who work all day with Claude Code across many
sessions. Its core idea fits in one line: **one active task at a time, and nothing gets
lost.**

**User experience comes first** (D55). The routine only works if it is used every day, so
it must be quick, clear and friendly. When a feature can be complete or easy to use, ease
of use wins: fewer, clearer options over complete but crowded ones. Every change to what
the user sees is judged against this before it ships.

This file says what holds **today**. Each rule carries the id of the decision behind it
(`D10`). Superseded decisions stay in the index at the end, marked, so the history is
traceable without reading as current. Requirements and their tests live in
[`REQUIREMENTS.md`](REQUIREMENTS.md); the contracts the pieces share, in
[`INTERFACES.md`](INTERFACES.md).

## 1 · The day

| Stage | Who | What happens |
|---|---|---|
| 0 · Before the user arrives | a Windows scheduled task (D38) | Collects the inventory: one count per channel, and only what is **new** since the last sheet is expanded (D29). It never ranks or proposes (D19). A failed source is reported, never shown as empty |
| 1 · Morning | the `morning` skill, ~10 min (P1) | Closes yesterday if it is still open (D24, D28) → reads the calendar and mail through Claude's connectors (D38) → asks the **mode** (full / normal / light / bad) and **how many hours and which** (D12) → the user picks **one priority** and the tasks, each with a complete card (D10, D37). Opportunities are never capped (D5). Two old items a day are offered (D31) |
| 2 · Start | the mod (P3) | "Let's do T2" in any session, new or open (D21, D47). The session receives the task card and its last note |
| 3 · During | the mod + each session | Band above the prompt: task, time, buttons (D8). Pomodoro by default (D50). A drift warning once, answered with "back" or a reason (D9, D37). Ideas go to the inbox without leaving the task (D26) |
| 4 · Done | the mod | One step: a row of buttons and one note the session pre-drafts and the user corrects (D52) |
| 5 · Close | the mod + the user | Each unfinished task: tomorrow, a project ledger, or drop. Inbox items go to their place (D27). "Tomorrow's thing" in one sentence. Unfinished tasks and inbox items carry over **automatically**, so skipping the close loses nothing (D28) |

**No fixed start time** (D11): the sheet is ready whenever the user arrives, weekends
included. At most **one day can be open** (D28), because a new day cannot open before the
previous one is closed (D24).

## 2 · Tasks

- **One active task**, started and kept until finished, with breaks allowed (D10).
  Starting another pauses the current one.
- **A task card** has: what comes out, done when, first step (two minutes or less),
  perimeter (what counts as related), kind, project (D10, D37, D47). A task cannot start
  with an incomplete card.
- **Leaving and done write a note**: what was done, where I stopped, next step (D47). That
  note is the checkpoint whoever resumes the task reads first. A pause alone writes none
  (D56).
- **Pause stops the task at the click** (D56): the pause is written with the time of the
  click, before anything is asked. Only the active task can be paused. Then the user picks
  **why** from buttons only, no free text, so the reasons can be counted later: planned,
  interrupted, blocked, switched, low energy, lost focus, other. Until a pick the pause has
  **no reason**. A pick is written at once and closes the row, back to the band line where
  Resume is. Resume closes the pause as it is, so a pause never given a reason stays
  without one. Starting another task pauses the active one with the reason "switched". "Other" is
  the check on the list: if it gets more than one pause in ten, the list is wrong. The
  reason is focus data (D44). **A pause is only a pause**: it writes no context, because the
  session stays open however long the user is away (G, 2026-10-12). Saving the context to
  resume in another session belongs to leaving the session, not to pausing: where it goes
  (Done or its own button) is open. The
  reasons live in the band, not in the engine's question dialog: that dialog takes 2-4
  options and always adds free text. Open: whether seven buttons fit the band or it drops
  to four (D55), and the prompt while paused (a mod cannot grey the prompt box out; it can
  only drop a submitted prompt).
- **Carried tasks keep their id** and a counter of how many days they carried (D28).

## 3 · Drift (staying on the task)

- The session the user writes in judges whether a message fits the active task, using
  the task's **perimeter** (D16 → D37). Example perimeter for a reading: questions about
  the text, unknown terms, links to my project; anything else is drift.
- It warns **once per drift episode** (D9, D54): no new warning while one is unanswered, nor after
  the user justified staying; after going back, a new drift can be warned. The user goes back,
  or continues and writes why. Both are logged.
- Two cheap calibrations (D37): a one-tap "did I drift?" when a task is done, and the
  folder each session works in as an objective signal.
- **Zero warnings is recorded as "not measured", never as "no drift"** (pre-mortem).

## 4 · Done row (configurable)

The fields of the done step live in the user's config (`done_fields.toml`), not in the
code (D52). Default set: rating (🔥 😐 🥱) and why (D14, D17) · how it was learned
(reading / doing it with Claude / video / Claude quizzed me) (D42, D43) · drift yes/no
(D37) · phone or distractions yes/no (D51) · the note and what I take away (D47, D42).

## 5 · Capture and where things go

- **One inbox** during the day: `/inbox <text>` (D26). It persists until sorted (D28).
- At the close each item goes to **one** place (D32):
  - **a task** if it has a purpose with a date or a project → the project's ledger,
    through that project's own entry command (D27). A project without one is not a valid
    destination: the item goes to a shared holding list, dated (D34);
  - **content** otherwise → the library: to read, to watch, open topics, ideas to build (D26).
- **The library expires**: an item untouched for 5 weeks asks for a decision: promote,
  keep or drop. One expired item per close (D33). Drawers are re-made from real usage
  after a few weeks (D26).
- **Opportunities** (jobs, calls) go to their own queue, never to the library (D32).

## 6 · Channels

Every place where work for the user piles up is a **channel**, declared in
`channels.toml` with a label: **source** (read), **copy** (ignored) or **dead** (emptied
once into its source, then archived) (D20, D40). Alerts from other projects are channels
too (D30). The sheet shows one count per channel and expands only what is new (D29).

## 7 · Data and privacy

- **Code is public, data is private, and the data lives outside the repository** (D45,
  D46). A push cannot carry personal data because it is not in the repo. Second layer: a
  pre-push guard that blocks credentials, personal paths and internal files.
- **No personal or health information about the user appears in the public repo** (D45).
- **Focus data** (drift replies, mode, phone checks) stays in the private data folder and
  is never stored as reusable text (D44).
- **Things the user said** (reactions, answers, thoughts, statements) are kept for reuse
  in applications and posts (D44).

## 8 · Architecture

- **Single writer** (D35): a CLI (`python -m routine`) takes an OS lock, checks the rules,
  appends events to `diary/YYYY-MM/YYYY-MM-DD.jsonl` and refreshes `state/today.json`.
  Nobody else writes the diary. The markdown sheet is a view.
- **The mod** runs one copy per session. It never writes files itself; it calls the CLI
  (review: `$.fs.write` rewrites whole files with no lock). It does not load in
  non-interactive `claude -p` sessions such as overnight robots (review). It injects the
  active task as context on each prompt, read at send time (D16, review).
- **The prepared sheet** is a Windows scheduled task that runs at logon if its time was
  missed (D38). Mail and calendar come from Claude's connectors when the user arrives.
- **Token usage** is logged per turn while a task is active, so each task has a cost (D39).
- **English everywhere** in the product (D36).

## 9 · Success criterion

A day is **fulfilled** when its priority is done and the day is closed (D41). The routine
works if **75 %** of counted days are fulfilled, excluding written exceptions (D7). Days
counted: every calendar day since launch; a day not opened counts as not fulfilled unless
it has a written exception (D41, review C18). First review two weeks after launch (D7).

## 10 · Out of scope for now

Weekly and monthly reviews (D25). A project-level checkpoint at the close is proposed but
not decided (D48).

## Decision index

| D | Status | One line |
|---|---|---|
| D1 | superseded → D11 | the day starts at 9:00 |
| D2 | process | rough design first, polished slowly |
| D3 | goal | costly tasks must be protected from rewarding ones |
| D4 | partly retired by D5 | rewarding tasks of the user; building with Claude still competes |
| D5 | current | opportunities are never capped; outputs of scheduled jobs must reach the sheet |
| D6 | approach | start simple: reminders, fixed times, checklists |
| D7 | current | success = 75 % of days; review after two weeks |
| D8 | current | the routine lives in a Claude Desktop mod; recap on demand and after a pause |
| D9 | current | drift: warn once, justify to continue, log both |
| D10 | current | one active task until finished; well-defined tasks |
| D11 | current | no fixed start time; no rush |
| D12 | current | morning asks mode and hours after the calendar; tasks come from the ledgers |
| D13 | need | many drawers to keep things ordered |
| D14 | current | rating and why when a task is done |
| D15 | superseded → D37 | measure two drift detectors |
| D16 | superseded → D37 | each session judges drift |
| D17 | current | rating as buttons; most tasks end in a commit |
| D18 | superseded → D45, D46 | private repo |
| D19 | current | the prepared sheet never ranks |
| D20 | current | inventory the channels from the source files |
| D21 | current | start a task in any session, new or open |
| D22 | refined by D50 | break techniques logged |
| D23 | current | done via button or chat |
| D24 | current | close is mandatory; no new day before closing |
| D25 | scope | daily first; weekly and monthly later |
| D26 | current | one inbox; library drawers; re-made from usage |
| D27 | current | sorting at the close through each project's entry command |
| D28 | current | at most one open day; automatic carry-over; persistent inbox |
| D29 | current | one count per channel; only new items expanded |
| D30 | current | alerts from all projects are channels |
| D31 | current | two old items a day |
| D32 | current | purpose with date or project → task; otherwise content; one place per item |
| D33 | current | library items expire after 5 weeks |
| D34 | current | projects without an entry command get one; meanwhile a holding list |
| D35 | current | single writer; events are the truth |
| D36 | current | the product is in English |
| D37 | current | the session judges drift with the task perimeter, plus two calibrations |
| D38 | current | Windows prepares the sheet; mail and calendar on arrival |
| D39 | current | token usage measured per task |
| D40 | current | channels labelled source / copy / dead |
| D41 | current | fulfilled day = priority done + day closed |
| D42 | current | learning log per task: what and how |
| D43 | current | learning modes as buttons |
| D44 | current | things the user said are kept; focus data never |
| D45 | current | public repo; nothing about health or focus in it |
| D46 | current | data folder outside the repo |
| D47 | current | the task card and its note act as checkpoint |
| D48 | proposed | project checkpoint at the close |
| D49 | user habit | long-lived lead sessions are fine; the close is the safety net |
| D50 | current | pomodoro by default; no phone during breaks |
| D51 | current | phone and distractions check when a task is done |
| D52 | current | done in one step; its fields are configurable |
| D53 | process | build go-ahead |
| D54 | current | drift is warned once per episode: no new warning while one is open or after the user justified staying; after "back", a new drift can be warned |
| D55 | principle | user experience comes first: quick, clear and friendly beats complete; every visible change is judged against it |
| D56 | current, partly open | pause stops at the click; the reason is picked from buttons only, starts as none, and the pick closes the row; a pause writes no context (where leaving saves it is open) |
| D57 | current | finished (done or dropped) is final: start, done and drop are refused; only reopen, with a reason, brings a task back. Done without start is accepted and marked unstarted |
| D58 | current | the first prompt of the day asks whether to start the day with /plan-day, once per session per day |
| D59 | current | automatic pause after N idle minutes counted from the end of the session's last answer; configurable; reason idle |
| D60 | process | new tasks are launched as sessions by the lead session when the user asks |
| D61 | current | a task card can be edited (title, done when, first step, perimeter, kind, project, priority) but its three start fields cannot be emptied |
| D62 | current | a task can wait: its session works alone; waiting counts as paused that moves on (not the user's working time), frees the active slot, never auto-pauses; it comes back with start, or ends with done or drop |
| D63 | current | a day whose priority was dropped for a good reason counts as a justified exception, neither fulfilled nor failed |
| D64 | current | the band belongs to its session: each task remembers the session that works on it, and a session's band shows that task (active, paused or waiting) plus, dimmed, the day's active task when it is elsewhere; a slow side task can start straight as waiting in its own session |
| D65 | current | pausing, waiting, finishing or dropping a task with an open drift warning closes the warning as unanswered, logged as data |
| D66 | current | surrounding rules: a break can start with zero, one or more tasks running; starting a task ends a break; closing the day pauses the active task and ends a break; one priority a day, a new one replaces the old |
