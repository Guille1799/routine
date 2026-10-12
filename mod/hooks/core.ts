// Pure logic of the mod: no `$`, no clock, no files. Everything here is a
// function of today.json (the writer's read model) and plain arguments, so the
// tests can prove it without an engine.

export type Card = {
  id: string
  title?: string
  done_when?: string
  first_step?: string
  perimeter?: string
  kind?: string
  project?: string
  priority?: boolean
  last_note?: string
  status: 'pending' | 'active' | 'paused' | 'waiting' | 'done' | 'dropped'
  carried?: number
  notes?: string[]
  since?: string
  /** When the task started waiting (D62): a session works alone on it, the active slot is free. */
  waiting_since?: string
  /** The session of its last start or wait (D64): that session's band and context show it. */
  session?: string
  /** Every pause, at the click; reason null until the user picks one (D56). */
  pauses?: { at: string; reason: string | null }[]
}

export type Today = {
  day: string | null
  open: boolean
  closed: boolean
  mode?: string | null
  tasks: Record<string, Card>
  order: string[]
  active: string | null
  /** The task paused last, while it stays paused: what the band offers to resume. */
  last_paused?: string | null
  inbox: Record<string, { text: string; since: string }>
  break: { technique: string; minutes?: number | null; since: string } | null
  drift: Record<string, { warned: number; replies: { action: string; why?: string }[]; open?: boolean }>
  last_ts: string | null
}

export type DoneField = {
  id: string
  label: string
  kind: 'buttons' | 'yesno' | 'text'
  options?: string[]
  required?: boolean
  prefill?: string
}

export type FieldValue = string | boolean

// The writer CLI's actions this mod uses. The CLI spells them with dashes.
export type WriterAction =
  | 'start' | 'pause' | 'pause_reason' | 'checkpoint' | 'wait' | 'done' | 'reopen' | 'task_edit' | 'drift_warn' | 'drift_reply'
  | 'inbox' | 'said' | 'break_start' | 'break_end' | 'usage'

export type WriterCall = {
  action: WriterAction
  task?: string
  data?: Record<string, unknown>
  session?: string
  cwd?: string
}

/** The argv for `python -m routine <action> ...`: the only way this mod writes. */
export function writerArgv(python: string, call: WriterCall): string[] {
  const argv = [python, '-m', 'routine', call.action.replace(/_/g, '-')]
  if (call.task) argv.push('--task', call.task)
  argv.push('--data', JSON.stringify(call.data ?? {}))
  if (call.session) argv.push('--session', call.session)
  if (call.cwd) argv.push('--cwd', call.cwd)
  return argv
}

export type WriterOutcome =
  | { ok: true; events: unknown[] }
  | { ok: false; reason: 'refused' | 'no-data' | 'failed'; error: string }

/** Reads the CLI's answer by its exit code: 0 written, 1 refused, 2 no data folder. */
export function readWriterAnswer(exitCode: number, stdout: string, stderr: string): WriterOutcome {
  let body: { ok?: boolean; error?: string; events?: unknown[] } = {}
  try {
    body = JSON.parse(stdout)
  } catch {
    body = {}
  }
  if (exitCode === 0) return { ok: true, events: body.events ?? [] }
  const error = body.error ?? (stderr.trim().split('\n').pop() || `exit code ${exitCode}`)
  if (exitCode === 1) return { ok: false, reason: 'refused', error }
  if (exitCode === 2) return { ok: false, reason: 'no-data', error }
  return { ok: false, reason: 'failed', error }
}

/** "T2" is a spoken alias: the position in today's order (D21, INTERFACES §4). */
export function aliasOf(today: Today, id: string): string {
  const n = today.order.indexOf(id)
  return n < 0 ? id : `T${n + 1}`
}

/**
 * Resolves what the user or the model said ("T2", "t2", "2", or a stable id)
 * to the stable task id; undefined when today has no such task.
 */
export function resolveTask(today: Today, said: string | undefined): string | undefined {
  if (!said) return today.active ?? undefined
  const ref = said.trim()
  if (today.tasks[ref]) return ref
  const m = /^t?(\d+)$/i.exec(ref)
  if (m) return today.order[Number(m[1]) - 1]
  return undefined
}

export function minutesBetween(fromIso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 60000))
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

/** "09:41" from an ISO timestamp, in the timestamp's own offset. */
export function clockOf(iso: string | null): string {
  if (!iso) return '--:--'
  const m = /T(\d{2}:\d{2})/.exec(iso)
  return m ? m[1]! : iso
}

export const POMODORO_WORK_MIN = 25

export type BreakChoice = { technique: string; minutes: number; label: string }

/** Pomodoro first: it is the default (D50). The others are offered, never recommended. */
export const BREAKS: readonly BreakChoice[] = [
  { technique: 'pomodoro', minutes: 5, label: '5 min' },
  { technique: 'pomodoro-long', minutes: 15, label: '15 min' },
  { technique: '52-17', minutes: 17, label: '17 min' },
]

/**
 * Milliseconds left in the break, computed from the `break_start` event the
 * writer stored, never from a timer of this module: a reload loses timers,
 * not the diary (R25).
 */
export function breakLeftMs(brk: Today['break'], nowMs: number): number | undefined {
  if (!brk) return undefined
  const minutes = brk.minutes ?? 5
  return Date.parse(brk.since) + minutes * 60000 - nowMs
}

/** Why a pause happened, buttons only (D56). The writer keeps the same list. */
export const PAUSE_REASONS = ['planned', 'interrupted', 'blocked', 'switched', 'low energy', 'lost focus', 'other'] as const

/**
 * This session's task (D64): the unfinished task whose last start or wait came from this
 * session. Active first, then waiting, then paused (the one paused last first); a session
 * that started several keeps the one it is on.
 */
export function ownTask(today: Today, session: string): string | undefined {
  const rank = (id: string): number => {
    const st = today.tasks[id]?.status
    if (st === 'active') return 0
    if (st === 'waiting') return 1
    if (st === 'paused') return id === today.last_paused ? 2 : 3
    return 9
  }
  const mine = today.order.filter(id => today.tasks[id]?.session === session && rank(id) < 9)
  return mine.sort((a, b) => rank(a) - rank(b))[0]
}

export type Band = {
  date: string
  progress: string
  /** This session's task, active: with its timer and Pause / Done / Wait. */
  task?: { id: string; alias: string; title: string; elapsed?: string; breakDue: boolean }
  /** This session's task, paused: the band offers Resume. */
  resume?: { id: string; alias: string; title: string; reason: string | null }
  /** This session's task, waiting (D62): a side task this session works on alone. */
  waiting?: { id: string; alias: string; title: string; since: string }
  /** The day's active task when it belongs to another session, shown dimmed (D64). */
  elsewhere?: { alias: string; title: string }
  break?: { leftMin: number; isOver: boolean }
  asOf: string
}

/** What the band of `session` says (D64): its own task, the day's active one if elsewhere, the data time (R17). */
export function band(today: Today, nowMs: number, session = ''): Band {
  const live = today.order.filter(id => today.tasks[id]?.status !== 'dropped')
  const done = live.filter(id => today.tasks[id]?.status === 'done').length
  const out: Band = {
    date: today.day ?? '',
    progress: `${done} of ${live.length} done`,
    asOf: clockOf(today.last_ts),
  }
  const left = breakLeftMs(today.break, nowMs)
  if (left !== undefined) {
    out.break = { leftMin: Math.max(0, Math.ceil(left / 60000)), isOver: left <= 0 }
  }
  const own = ownTask(today, session)
  const card = own ? today.tasks[own] : undefined
  if (own && card?.status === 'active') {
    const min = card.since ? minutesBetween(card.since, nowMs) : undefined
    out.task = {
      id: own,
      alias: aliasOf(today, own),
      title: card.title ?? own,
      elapsed: min === undefined ? undefined : formatMinutes(min),
      breakDue: min !== undefined && min >= POMODORO_WORK_MIN,
    }
  } else if (own && card?.status === 'waiting') {
    out.waiting = { id: own, alias: aliasOf(today, own), title: card.title ?? own, since: clockOf(card.waiting_since ?? null) }
  } else if (own && card?.status === 'paused') {
    out.resume = { id: own, alias: aliasOf(today, own), title: card.title ?? own, reason: card.pauses?.at(-1)?.reason ?? null }
  }
  if (today.active && today.active !== own) {
    out.elsewhere = { alias: aliasOf(today, today.active), title: today.tasks[today.active]?.title ?? today.active }
  }
  return out
}

const MARK: Record<Card['status'], string> = {
  pending: '[ ]', active: '[>]', paused: '[~]', waiting: '[w]', done: '[x]', dropped: '[-]',
}

export function taskList(today: Today): string {
  return today.order
    .map((id, n) => `T${n + 1} ${MARK[today.tasks[id]?.status ?? 'pending']} ${today.tasks[id]?.title ?? id}`)
    .join('\n')
}

export type TaskRow = {
  id: string
  alias: string
  mark: string
  title: string
  doneWhen?: string
  firstStep?: string
  carried: number
  /** The day's one priority (D10). */
  priority: boolean
  /** What the row offers: start a pending, paused or waiting task, finish the active one, reopen a finished one (D57). */
  action: 'start' | 'done' | 'reopen' | null
  /** The active and paused tasks can be set waiting (D62). */
  canWait: boolean
  /** For a waiting task, since when (HH:MM). */
  waitingSince?: string
}

/** Today's full list for the pane, in today's order (the expanded band). */
export function taskRows(today: Today): TaskRow[] {
  return today.order.map((id, n) => {
    const t = today.tasks[id]
    const status = t?.status ?? 'pending'
    return {
      id,
      alias: `T${n + 1}`,
      mark: MARK[status],
      title: t?.title ?? id,
      doneWhen: t?.done_when,
      firstStep: t?.first_step,
      carried: t?.carried ?? 0,
      priority: t?.priority === true,
      action: status === 'active' ? 'done' : status === 'pending' || status === 'paused' || status === 'waiting' ? 'start' : 'reopen',
      canWait: status === 'active' || status === 'paused',
      waitingSince: status === 'waiting' ? clockOf(t?.waiting_since ?? null) : undefined,
    }
  })
}

/**
 * Where the task's drift episode stands, as the writer folded it (D9, D54): a
 * warning waiting for the user's answer, the user already justified staying, or
 * clear. Only words for the model: the writer is the one that refuses.
 */
export function driftState(today: Today, task: string): 'open' | 'justified' | 'clear' {
  const d = today.drift[task]
  if (d?.open) return 'open'
  if (d?.replies.at(-1)?.action === 'continue') return 'justified'
  return 'clear'
}

/**
 * The context each prompt carries while a day is open (R15): the active task's
 * card and perimeter and how to treat drift (D9, D37), or today's list and how
 * to start a task. Read at send time, so it is never stale.
 */
export function promptContext(today: Today, tool: string, session = ''): string | undefined {
  if (!today.open) return undefined
  const lines = [`[routine] Day ${today.day}. Tasks (say "T2" for the 2nd):`, taskList(today)]
  const id = ownTask(today, session)
  const elsewhere = today.active && today.active !== id ? today.active : undefined
  if (elsewhere) {
    lines.push(`The day's active task is ${aliasOf(today, elsewhere)}, in another session: not this conversation's task.`)
  }
  const card = id ? today.tasks[id] : undefined
  if (!id || !card) {
    lines.push(
      `No task in this session. When the user says "let's do T2" (or similar), call ${tool} with action "start" and task "T2"; ` +
        'for a slow side task that runs here on its own, action "wait" with the task.',
    )
    return lines.join('\n')
  }
  if (card.status === 'paused') {
    lines.push('', `This session's task ${aliasOf(today, id)} is paused: ${card.title ?? id}. "let's go on" → ${tool} action "start" with task "${aliasOf(today, id)}".`)
    return lines.join('\n')
  }
  lines.push(
    '',
    card.status === 'waiting'
      ? `Side task ${aliasOf(today, id)} (waiting: this session works on it on its own): ${card.title ?? id}`
      : `Active task ${aliasOf(today, id)}: ${card.title ?? id}`,
    `Done when: ${card.done_when ?? '-'}`,
    `First step: ${card.first_step ?? '-'}`,
    `Perimeter (what counts as related): ${card.perimeter ?? '-'}`,
  )
  const note = card.notes?.at(-1) ?? card.last_note
  if (note) lines.push(`Last note: ${note}`)
  const drift = driftState(today, id)
  if (drift === 'open') {
    lines.push(
      'Drift: a warning is open. If this message answers it, call ' +
        `${tool} with action "drift_reply": reply "back", or reply "continue" with why = their reason. Do not warn again.`,
    )
  } else if (drift === 'justified') {
    lines.push('Drift: the user already justified staying on this. Do not warn again.')
  } else {
    lines.push(
      'Drift: if the user\'s message falls outside the perimeter, say so in ONE line before anything else and ' +
        `call ${tool} with action "drift_warn" and message = a short summary of the message. ` +
        'Then follow the user: going back → action "drift_reply" with reply "back"; ' +
        'continuing → action "drift_reply" with reply "continue" and why = their reason (ask for it in one line if they gave none). ' +
        'Warn once per drift.',
    )
  }
  lines.push(
    `When the user says the task is done, call ${tool} with action "done": draft the note yourself ` +
      '(done / stopped at / next / I take away), ask only for the fields the tool says are missing.',
    `"pause" → ${tool} action "pause" with a note: what was done, where it stopped, next step.`,
  )
  return lines.join('\n')
}

/** The required fields with no value: what the session must still ask (R19). */
export function missingFields(fields: readonly DoneField[], values: Record<string, unknown>): DoneField[] {
  return fields.filter(f => {
    if (!f.required) return false
    const v = values[f.id]
    if (f.kind === 'yesno') return typeof v !== 'boolean'
    if (f.kind === 'buttons') return typeof v !== 'string' || !(f.options ?? []).includes(v)
    return typeof v !== 'string' || v.trim() === ''
  })
}

/** Keeps only the configured fields, each in its kind: the config decides, not the code (R32). */
export function cleanFields(fields: readonly DoneField[], values: Record<string, unknown>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const f of fields) {
    const v = values[f.id]
    if (f.kind === 'yesno' && typeof v === 'boolean') out[f.id] = v
    else if (f.kind === 'buttons' && typeof v === 'string' && (f.options ?? []).includes(v)) out[f.id] = v
    else if (f.kind === 'text' && typeof v === 'string' && v.trim() !== '') out[f.id] = v.trim()
  }
  return out
}

/** How the session asks for the fields still missing. */
export function askFor(missing: readonly DoneField[]): string {
  return missing
    .map(f => {
      if (f.kind === 'yesno') return `${f.id} (${f.label}): yes or no`
      if (f.kind === 'buttons') return `${f.id} (${f.label}): one of ${(f.options ?? []).join(' / ')}`
      return `${f.id} (${f.label}): text`
    })
    .join('; ')
}

/** The text after `/inbox`, or undefined when the prompt is not an inbox capture (R20). */
export function inboxText(prompt: string): string | undefined {
  const m = /^\/inbox(?:\s+([\s\S]*))?$/.exec(prompt.trim())
  if (!m) return undefined
  return (m[1] ?? '').trim()
}

/** The local date (YYYY-MM-DD) of a moment; the hooks environment runs on the user's time zone. */
export function localDate(nowMs: number): string {
  const d = new Date(nowMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Whether the user has today open: `open`, `none` (no diary, or the last day is closed
 * and older than today), or `stale` (an older day is still open: /plan-day closes it first).
 * A day closed today counts as open: the day happened.
 */
export type DayStatus = { kind: 'open' } | { kind: 'none'; date: string } | { kind: 'stale'; date: string; openDay: string }

export function dayStatus(today: Today | undefined, date: string): DayStatus {
  if (!today?.day) return { kind: 'none', date }
  if (today.day >= date) return { kind: 'open' }
  if (today.open) return { kind: 'stale', date, openDay: today.day }
  return { kind: 'none', date }
}

/** What the model reads when the day is not open: ask once, in one line, whether to plan it. */
export function planDayContext(status: DayStatus): string | undefined {
  if (status.kind === 'open') return undefined
  const lines = [
    `[routine] No day is open for today (${status.date}). Before anything else, ask the user in ONE short line ` +
      'whether to start the day with /plan-day; then go on with their message either way. Ask only this once.',
  ]
  if (status.kind === 'stale') lines.push(`Day ${status.openDay} is still open: /plan-day closes it first.`)
  return lines.join(' ')
}

/**
 * What the band line keeps at a width (G works with 2-3 panes side by side). The task,
 * its timer, Pause and Done always stay; the rest gives way first: the date, then the
 * long forms, then Recap and the progress, then Tasks. Recap and Break are also in the
 * Tasks pane, so nothing hidden here is out of reach.
 */
export type BandFit = {
  date: boolean
  progress: 'long' | 'short' | null
  recap: boolean
  tasks: boolean
  /** `when-due`: Break shows only once 25 minutes of work are up. */
  break: 'always' | 'when-due'
  asOf: 'long' | 'short'
}

export const BAND_WIDE = 100
export const BAND_MEDIUM = 72
export const BAND_NARROW = 48

export function bandFit(columns: number): BandFit {
  if (columns >= BAND_WIDE) return { date: true, progress: 'long', recap: true, tasks: true, break: 'always', asOf: 'long' }
  if (columns >= BAND_MEDIUM) return { date: false, progress: 'short', recap: true, tasks: true, break: 'always', asOf: 'short' }
  if (columns >= BAND_NARROW) return { date: false, progress: null, recap: false, tasks: true, break: 'when-due', asOf: 'short' }
  return { date: false, progress: null, recap: false, tasks: false, break: 'when-due', asOf: 'short' }
}

/** "1/3": the progress in five characters. */
export function shortProgress(today: Today): string {
  const live = today.order.filter(id => today.tasks[id]?.status !== 'dropped')
  return `${live.filter(id => today.tasks[id]?.status === 'done').length}/${live.length}`
}

/**
 * The automatic pause (D59): after `minutes` idle minutes, counted from the latest of
 * this session's last answer, the diary's last event (any session's activity) and the
 * task's start, the active task is paused with the reason `idle`. Nothing to do when it
 * is off (0), no day is open, no task is active (a waiting one never is), a break runs,
 * or the active task belongs to another session (D64).
 */
export type IdleDue = { kind: 'off' } | { kind: 'wait'; ms: number } | { kind: 'pause'; task: string }

export const IDLE_DEFAULT_MINUTES = 20

export function idleDue(today: Today | undefined, lastAnswerAt: number, minutes: number, nowMs: number, session = ''): IdleDue {
  if (!today?.open || !today.active || minutes <= 0 || today.break) return { kind: 'off' }
  const card = today.tasks[today.active]
  if (!card || card.status !== 'active') return { kind: 'off' } // a waiting task is never the active one (D62)
  // Only the session working on it pauses it (D64); a task started outside any session, any of them.
  if (card.session && card.session !== session) return { kind: 'off' }
  const seen = [lastAnswerAt, today.last_ts ? Date.parse(today.last_ts) : 0, card.since ? Date.parse(card.since) : 0]
  const due = Math.max(...seen.filter(Number.isFinite)) + minutes * 60000
  return nowMs >= due ? { kind: 'pause', task: today.active } : { kind: 'wait', ms: due - nowMs }
}

/** The card fields the pane edits in place; kind, project and priority also go through chat (D61). */
export const PANE_EDIT_FIELDS = [
  ['title', 'Title'],
  ['done_when', 'Done when'],
  ['first_step', 'First step'],
  ['perimeter', 'Perimeter'],
] as const

/** Only what changed, trimmed: the edit the writer receives. Empty start fields are the writer's to refuse. */
export function cardChanges(card: Card, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [field] of PANE_EDIT_FIELDS) {
    const v = values[field]
    if (v !== undefined && v.trim() !== String(card[field] ?? '').trim()) out[field] = v.trim()
  }
  return out
}

/**
 * The per-session chip in the prompt footer (SessionMode): Desktop draws it in every pane of
 * a split view, where the band shows only in the active one. 24 characters at most, the
 * width Desktop gives the chip.
 */
export function sessionChip(today: Today | undefined, session: string, nowMs: number): string | undefined {
  if (!today) return undefined
  if (!today.open) return 'no day open'
  const id = ownTask(today, session)
  const card = id ? today.tasks[id] : undefined
  if (!id || !card) return 'no task here'
  const alias = aliasOf(today, id)
  let label: string
  if (card.status === 'active') label = card.since ? `${alias} \u25b6 ${formatMinutes(minutesBetween(card.since, nowMs))}` : `${alias} \u25b6`
  else if (card.status === 'waiting') label = `${alias} waiting ${clockOf(card.waiting_since ?? null)}`
  else label = `${alias} paused`
  return label.slice(0, 24)
}
