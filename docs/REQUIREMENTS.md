# Requirements

Every current decision in [`DESIGN.md`](DESIGN.md) becomes at least one requirement here,
or appears in the list at the end with the reason it has none. Each requirement names the
test that proves it. `tests/test_traceability.py` fails if a decision is left uncovered or
a named test does not exist, so nothing in the plan can be silently skipped.

`Test` is either `tests/<file>::<function>` (must exist) or `pending: P<n>` while the
piece that owns it is being built.

| R | Requirement | D | Test |
|---|---|---|---|
| R1 | The repository holds no real data; the data folder lives outside it | D45, D46 | tests/test_writer.py::test_r1_data_dir_cannot_live_inside_the_repo |
| R2 | Nothing about the user's health, focus or personal paths in the repository | D45 | tests/test_public_repo.py::test_r2_no_private_terms_or_paths |
| R3 | The product is in English | D36 | pending: P4 |
| R4 | One writer, append-only, under an OS lock; concurrent writers lose nothing | D35 | tests/test_writer.py::test_r4_concurrent_writers_never_lose_an_event |
| R5 | Versioned event schema; invalid events are refused and nothing is written | D35 | tests/test_writer.py::test_r5_schema_rejects_invalid_events |
| R6 | One active task at a time; starting another pauses the current one | D10 | tests/test_writer.py::test_r6_starting_a_task_pauses_the_active_one |
| R7 | No new day while one is open, also under racing writers | D24, D28 | tests/test_writer.py::test_r4_r7_racing_writers_open_the_day_exactly_once |
| R8 | Unfinished tasks and inbox items carry over automatically, same id, with a counter | D28 | tests/test_writer.py::test_r8_unfinished_tasks_and_inbox_carry_over_with_a_counter |
| R9 | The prepared sheet collects the inventory without ranking, runs at logon if missed, and reports failed sources | D19, D38, D11 | tests/test_inventory.py::test_r9_inventory_never_ranks_and_reports_a_failed_source |
| R10 | One count per channel; only items new since the last sheet are expanded | D29, D5 | tests/test_inventory.py::test_r10_one_count_per_channel_and_only_new_items_expanded |
| R11 | Opportunities are never capped | D5 | tests/test_inventory.py::test_r11_opportunities_are_never_capped |
| R12 | Every channel has a label (source / copy / dead); only sources are read; alerts are channels | D20, D30, D40 | tests/test_inventory.py::test_r12_only_sources_are_read_and_every_channel_needs_a_label |
| R13 | The morning skill reads the calendar first, asks mode and hours, and asks (never proposes) the priority | D12, D19 | tests/test_inventory.py::test_r13_skill_text_keeps_the_order_and_the_never_rules |
| R14 | A task cannot start with an incomplete card | D10, D37, D47 | tests/test_writer.py::test_r14_incomplete_card_cannot_start |
| R15 | The active task is injected as context in interactive sessions, never in `claude -p` | D37, D8 | tests/test_mod.py::test_r15_task_context_only_in_interactive_sessions |
| R16 | Start, pause and done can be said in any session's chat and reach the writer | D21, D23, D47 | tests/test_mod_contract.py::test_r16_every_call_the_mod_makes_is_written_by_the_real_writer |
| R17 | The band shows task, time, buttons and the time of the data it read | D8, D38, D6 | tests/test_mod.py::test_r17_band_task_time_buttons_and_data_time |
| R18 | Drift is warned once per episode; continuing requires a reason; both are logged | D9, D37, D54 | tests/test_writer.py::test_r18_continuing_after_a_drift_warning_needs_a_reason |
| R19 | Done is one step with the configured fields; missing required fields are asked | D14, D17, D42, D43, D51, D23 | tests/test_mod.py::test_r19_done_in_one_step_missing_fields_asked |
| R20 | `/inbox <text>` captures without leaving the task | D26 | tests/test_mod.py::test_r20_inbox_without_a_model_turn |
| R21 | The close sends tasks through each project's entry command; projects without one go to the holding list | D27, D34 | pending: P4 |
| R22 | Close-time sorting applies the purpose rule (task vs content), one place per item | D32 | pending: P4 |
| R23 | Library items untouched for 5 weeks ask for a decision, one per close | D33 | pending: P4 |
| R24 | Two old items a day are offered in the sheet | D31 | tests/test_inventory.py::test_r24_two_old_items_are_offered_and_rotate |
| R25 | Breaks: technique and phone check logged; timer survives a reload | D50, D22 | tests/test_mod.py::test_r25_breaks_logged_and_timer_survives_reload |
| R26 | Recap on demand and after a pause | D8 | tests/test_mod.py::test_r26_recap_on_demand_and_after_a_break |
| R27 | Token usage logged per turn with an active task; total per task in the view | D39 | tests/test_mod.py::test_r27_usage_logged_per_turn_with_active_task |
| R28 | Focus data is never stored as reusable text | D44 | tests/test_writer.py::test_r28_attention_data_never_becomes_reusable_text |
| R29 | Fulfilled-day rate computed as priority done + day closed, over counted days | D41, D7 | pending: P4 |
| R30 | A missing data folder fails loudly with its own exit code | D46 | tests/test_writer.py::test_r30_missing_data_dir_fails_loudly |
| R31 | Install and uninstall with demo data, leaving nothing behind | D45 | pending: P4 |
| R32 | The done fields are read from the user's config, not the code | D52 | tests/test_writer.py::test_r32_done_fields_come_from_the_user_config |
| R33 | The writer CLI has stable exit codes: 0 written, 1 refused, 2 no data folder | D35, D46 | tests/test_writer.py::test_cli_exit_codes |

## Decisions without a requirement

- D1: superseded by D11.
- D2: a way of working, not system behaviour.
- D3: the goal; served by R6 and R14.
- D4: partly retired by D5; the remainder is an observation about the user.
- D13: a need, met by D26 (R20, R22, R23).
- D15: superseded by D37.
- D16: superseded by D37.
- D18: superseded by D45 and D46.
- D25: scope: weekly and monthly reviews are out of scope for now.
- D48: proposed, not decided.
- D49: a user habit, not system behaviour.
- D53: a process decision (go-ahead to build).
- D55: a principle that judges every visible change, not one behaviour.
- D56: decided but not built yet, and partly open (button count, prompt lock); it gets its requirements when it is built.

## Pieces

| P | Piece | Owner |
|---|---|---|
| P1 | Foundations: data folder, event schema, single writer, interfaces, traceability | lead session |
| P2 | Morning: Windows inventory task and the `morning` skill | build session |
| P3 | Mod: band, task tools, drift, done row, inbox, breaks, recap, usage | build session |
| P4 | Close-time sorting, library, holding list, fulfilled-day rate, install, language lint | after P2 and P3 |
