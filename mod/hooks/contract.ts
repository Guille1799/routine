// The writer calls this mod makes, one example per kind, as plain data.
//
// Two test suites share this list so the mod and the writer cannot drift apart:
// - the mod's tests (mod/tests) drive the mod and check it emits exactly these
//   calls (through writerArgv);
// - tests/test_mod_contract.py replays them, in order, through the real CLI
//   (`python -m routine`) and checks every one is written.
// "$task" stands for the task the scenario started. Keep the block between the
// markers valid JSON: the Python test reads it as such.
import type { WriterCall } from './core'

export const WRITER_CALLS: Record<string, WriterCall> = /* contract:start */ {
  "start": { "action": "start", "task": "$task" },
  "drift_warn": { "action": "drift_warn", "task": "$task", "data": { "message": "asked about the weekend" } },
  "drift_reply": { "action": "drift_reply", "task": "$task", "data": { "action": "continue", "why": "it is related after all" } },
  "inbox": { "action": "inbox", "data": { "text": "buy milk" } },
  "said": { "action": "said", "data": { "text": "this clicked for me", "kind": "reaction" } },
  "break_start": { "action": "break_start", "data": { "technique": "pomodoro", "minutes": 5 } },
  "break_end": { "action": "break_end", "data": { "phone": false } },
  "usage": { "action": "usage", "task": "$task", "data": { "input_tokens": 120, "output_tokens": 40, "cache_read_input_tokens": 900, "cache_creation_input_tokens": 0, "model": "claude-test" } },
  "pause": { "action": "pause", "task": "$task", "data": { "note": "read 3.1; stopped at 3.2; next: the figure" } },
  "pause_click": { "action": "pause", "task": "$task", "data": {} },
  "pause_reason": { "action": "pause_reason", "task": "$task", "data": { "reason": "interrupted" } },
  "pause_idle": { "action": "pause", "task": "$task", "data": { "reason": "idle" } },
  "checkpoint": { "action": "checkpoint", "task": "$task", "data": { "note": "read 3.2; stopped at the figure; next: section 4" } },
  "reopen": { "action": "reopen", "task": "$task", "data": { "why": "one more check after the review" } },
  "done": { "action": "done", "task": "$task", "data": { "fields": { "rating": "🔥", "learned_how": "reading", "drifted": false, "phone": false, "note": "notes written; next: section 4" }, "note": "notes written; next: section 4" } }
} /* contract:end */
