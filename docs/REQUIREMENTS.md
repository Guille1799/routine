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
| R21 | The close sends tasks through each project's entry command; projects without one go to the holding list | D27, D34 | tests/test_close.py::test_r21_sorting_runs_the_entry_command_or_holds_the_item |
| R22 | Close-time sorting applies the purpose rule (task vs content), one place per item | D32 | tests/test_close.py::test_r22_purpose_makes_a_task_otherwise_content_one_place_per_item |
| R23 | Library items untouched for 5 weeks ask for a decision, one per close | D33 | tests/test_close.py::test_r23_library_items_expire_after_five_weeks_one_offer_per_close |
| R24 | Two old items a day are offered in the sheet | D31 | tests/test_inventory.py::test_r24_two_old_items_are_offered_and_rotate |
| R25 | Breaks: technique and phone check logged; timer survives a reload | D50, D22 | tests/test_mod.py::test_r25_breaks_logged_and_timer_survives_reload |
| R26 | Recap on demand and after a pause | D8 | tests/test_mod.py::test_r26_recap_on_demand_and_after_a_break |
| R27 | Token usage logged per turn with an active task; total per task in the view | D39 | tests/test_mod.py::test_r27_usage_logged_per_turn_with_active_task |
| R28 | Focus data is never stored as reusable text | D44 | tests/test_writer.py::test_r28_attention_data_never_becomes_reusable_text |
| R29 | Fulfilled-day rate computed as priority done + day closed, over counted days | D41, D7 | tests/test_close.py::test_r29_fulfilled_day_rate_over_counted_days |
| R30 | A missing data folder fails loudly with its own exit code | D46 | tests/test_writer.py::test_r30_missing_data_dir_fails_loudly |
| R31 | Install and uninstall with demo data, leaving nothing behind | D45 | tests/test_install.py::test_r31_install_a_demo_and_uninstall_it_leaving_nothing_behind |
| R32 | The done fields are read from the user's config, not the code | D52 | tests/test_writer.py::test_r32_done_fields_come_from_the_user_config |
| R33 | The writer CLI has stable exit codes: 0 written, 1 refused, 2 no data folder | D35, D46 | tests/test_writer.py::test_cli_exit_codes |
| R35 | Finished tasks are final until reopened with a reason; done without start is marked | D57 | tests/test_writer.py::test_d57_finished_tasks_are_final_until_reopened |
| R34 | Pause is written at the click; its reason comes from buttons only, starts as none and changes only while the pause lasts; a pause writes no context | D56 | tests/test_writer.py::test_r34_pause_stops_at_the_click_and_the_reason_is_set_while_it_lasts |
| R36 | The first prompt of the day asks whether to start the day, once per session per day | D58 | tests/test_mod.py::test_r36_ask_to_start_the_day_once_per_session_per_day |
| R37 | Task cards can be edited, never emptied of their start fields | D61 | tests/test_writer.py::test_r37_task_card_can_be_edited_but_not_emptied |
| R38 | Automatic pause after idle minutes, configurable, reason idle | D59 | tests/test_mod.py::test_r38_idle_pause_after_configured_minutes |
| R39 | A task can wait (paused that moves on), freeing the active slot | D62 | tests/test_writer.py::test_r39_waiting_is_paused_that_moves_on_and_frees_the_active_slot |
| R40 | Each task remembers its session; a side task can start straight as waiting | D64 | tests/test_writer.py::test_r40_tasks_remember_the_session_that_works_on_them |
| R41 | A session's band shows its own task, and the day's active task dimmed when elsewhere | D64 | pending: P3 |
| R42 | A dropped priority with a reason makes the day a justified exception | D63 | tests/test_close.py::test_r42_a_priority_dropped_for_a_reason_is_a_justified_exception |
| R43 | Ending or pausing a task with an open drift warning closes it as unanswered | D65 | tests/test_writer.py::test_r43_ending_a_task_with_an_open_drift_warning_closes_it_as_unanswered |
| R44 | Every cell of the state table (6 states x 6 buttons) behaves as specified | D57, D62, D10 | tests/test_writer.py::test_r44_every_cell_of_the_state_table |
| R45 | Surrounding conditions: break with no task, start ends a break, close pauses and ends breaks, one priority | D66 | tests/test_writer.py::test_r45_surrounding_conditions |
| R46 | The band names the technique and shows work and break phases with their minutes | D67, D68 | tests/test_mod.py::test_r46_the_band_shows_the_work_and_break_rhythm |
| R47 | Closing the day commits diary/ and state/ in the data folder's git repository, never config; without one it says it skipped | D69 | tests/test_close.py::test_d69_the_close_commits_diary_and_state_only |

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
- D60: a process decision (how task sessions are launched).
- D55: a principle that judges every visible change, not one behaviour.

## Pieces

| P | Piece | Owner |
|---|---|---|
| P1 | Foundations: data folder, event schema, single writer, interfaces, traceability | lead session |
| P2 | Morning: Windows inventory task and the `morning` skill | build session |
| P3 | Mod: band, task tools, drift, done row, inbox, breaks, recap, usage | build session |
| P4 | Close-time sorting, library, holding list, fulfilled-day rate, install, language lint | after P2 and P3 |
