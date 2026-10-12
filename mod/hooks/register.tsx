// The routine mod: one copy runs per session. It never writes a file itself:
// every change goes through the single writer, `python -m routine <action>`
// (D35), and every read is a fresh read of <data>/state/today.json.
import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, PluginOptions, Register, RenderElement } from 'claude-code'

import type { RoutineForm } from '../types'
import {
  BREAK_MINUTES,
  TECHNIQUES,
  rhythm,
  PAUSE_REASONS,
  askFor,
  band,
  buttonLabel,
  cut,
  fitRows,
  cardChanges,
  PANE_EDIT_FIELDS,
  clockOf,
  cleanFields,
  dayStatus,
  IDLE_DEFAULT_MINUTES,
  idleDue,
  inboxText,
  localDate,
  missingFields,
  ownTask,
  planDayContext,
  promptContext,
  readWriterAnswer,
  resolveTask,
  sessionChip,
  shortProgress,
  aliasOf,
  taskList,
  taskRows,
  writerArgv,
} from './core'
import type { BandButton, DoneField, Today, WriterCall, WriterOutcome } from './core'

type $ = EngineInterface

export const TOOL = 'mcp__routine__routine'
export const PANE = 'routine-tasks'
const TICK_MS = 30_000

const form = atom({ plugin: 'routine', key: 'form' } as const, null)
const breakPick = atom({ plugin: 'routine', key: 'breakPick' } as const, false)
const dayAsked = atom({ plugin: 'routine', key: 'dayAsked' } as const, null)
const reopening = atom({ plugin: 'routine', key: 'reopen' } as const, null)
const editing = atom({ plugin: 'routine', key: 'editing' } as const, null)

const RECAP_PROMPT =
  'Recap for the user coming back: in at most three short lines, where we were in this session ' +
  'and the next concrete step. Reply with the recap only.'
const DONE_DRAFT_PROMPT =
  'Draft the closing note for the routine task in this session, at most four short lines: ' +
  'done / stopped at / next / what I take away. Reply with the note only.'

type Settings = { dataDir: string; python: string; codeDir: string }

type Read = { today: Today; problem?: undefined } | { today?: undefined; problem: string }

// The plugin's options, set once by register (one register per module load).
let OPTIONS: PluginOptions = {}
let isReady = false
let breakToastedFor: string | undefined
// The work phase whose end was already announced (D67), so the toast comes once.
let workToastedFor: string | undefined
// The idle pause (D59): this session's last answer and the timer that checks after it.
let lastAnswerAt = 0
let idleTimer: { cancel: () => void } | undefined

async function settings($: $): Promise<Settings> {
  const fromOptions = String(OPTIONS.dataDir ?? '').trim()
  const dataDir = fromOptions || ((await $.env.get('ROUTINE_DATA_DIR')) ?? '').trim()
  const codeDir = String(OPTIONS.codeDir ?? '').trim() || `${$.plugin.root}/..`
  return { dataDir, python: String(OPTIONS.python ?? '').trim() || 'python', codeDir }
}

/** Non-interactive runs (`claude -p`, overnight robots) draw nowhere: no inject, no write (R15). */
async function isInteractive($: $): Promise<boolean> {
  return (await $.session.surfaces()).length > 0
}

async function readToday($: $): Promise<Read> {
  const { dataDir } = await settings($)
  if (!dataDir) return { problem: 'no data folder: set dataDir in the routine plugin options' }
  try {
    return { today: JSON.parse(await $.fs.read(`${dataDir}/state/today.json`)) as Today }
  } catch {
    const exists = await $.fs.stat(dataDir).then(() => true, () => false)
    return { problem: exists ? 'no diary yet · /plan-day' : `no data folder: ${dataDir}` }
  }
}

async function write($: $, call: WriterCall): Promise<WriterOutcome> {
  if (!(await isInteractive($))) {
    return { ok: false, reason: 'refused', error: 'the routine does not write from non-interactive sessions' }
  }
  const s = await settings($)
  const argv = writerArgv(s.python, { ...call, session: await $.session.id(), cwd: await $.session.cwd() })
  const env: Record<string, string> = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  if (s.dataDir) env.ROUTINE_DATA_DIR = s.dataDir
  let outcome: WriterOutcome
  try {
    const ran = await $.process.run(argv, { cwd: s.codeDir, env })
    outcome = readWriterAnswer(ran.exitCode, ran.stdout, ran.stderr)
  } catch (err) {
    outcome = { ok: false, reason: 'failed', error: `the writer did not run: ${String(err)}` }
  }
  $.ui.invalidate('ui.render')
  return outcome
}

/** The done fields come from <data>/config/done_fields.toml, read by the writer's CLI (R32). */
async function doneFields($: $): Promise<DoneField[] | string> {
  const s = await settings($)
  const env: Record<string, string> = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  if (s.dataDir) env.ROUTINE_DATA_DIR = s.dataDir
  try {
    const ran = await $.process.run([s.python, '-m', 'routine', 'fields'], { cwd: s.codeDir, env })
    const answer = readWriterAnswer(ran.exitCode, ran.stdout, ran.stderr)
    if (!answer.ok) return `cannot read the done fields: ${answer.error}`
    return (JSON.parse(ran.stdout) as { fields: DoneField[] }).fields
  } catch (err) {
    return `cannot read the done fields: ${String(err)}`
  }
}

/**
 * Recap (R26, D8): one question over this session's transcript. Never the built-in /recap:
 * the engine refuses a /recap that a plugin runs ("sent by a routine or another program",
 * seen 2026-10-12), so the fork is the only way that works from a button.
 */
async function recap($: $): Promise<void> {
  const r = await $.model.fork({ prompt: RECAP_PROMPT })
  if (r.isAnswered) $.ui.log(`Recap: ${r.text}`)
  else if (r.reason === 'nothing-to-fork') $.ui.log('Recap: nothing to recap yet in this session.')
  else $.ui.log(`Recap failed: ${r.reason}`)
}

async function draftNote($: $, prompt: string): Promise<void> {
  const r = await $.model.fork({ prompt })
  const text = r.isAnswered ? r.text.trim() : ''
  await update($, form, f => (f ? { ...f, draft: text } : f))
}

/** Pause stops the task at the click (D56); the band then asks only why. */
async function pauseNow($: $, task: string): Promise<void> {
  const out = await write($, { action: 'pause', task })
  if (!out.ok) {
    $.ui.toast(`Pause: ${out.error}`)
    return
  }
  await update($, form, () => ({ kind: 'pause' as const, task, values: {}, draft: '', error: null }))
}

async function setReason($: $, task: string, reason: string): Promise<void> {
  const out = await write($, { action: 'pause_reason', task, data: { reason } })
  return closeOrShow($, out) // the pick closes the row: back to the line, where Resume is
}

async function openForm($: $, task: string): Promise<void> {
  const fields = await doneFields($)
  if (typeof fields === 'string') {
    $.ui.toast(fields)
    return
  }
  const needsDraft = fields.some(f => f.kind === 'text' && f.prefill === 'session')
  await update($, form, () => ({ kind: 'done' as const, task, values: {}, draft: needsDraft ? null : '', error: null }))
  if (needsDraft) await draftNote($, DONE_DRAFT_PROMPT)
}

async function saveForm($: $): Promise<void> {
  const f = await read($, form)
  if (!f) return
  if (f.kind === 'pause') return // a pause saves nothing more than its reason
  const fields = await doneFields($)
  if (typeof fields === 'string') {
    await update($, form, x => (x ? { ...x, error: fields } : x))
    return
  }
  const values: Record<string, unknown> = { ...f.values }
  const noteField = fields.find(x => x.kind === 'text')
  if (noteField && values[noteField.id] === undefined && f.draft) values[noteField.id] = f.draft
  const missing = missingFields(fields, values)
  if (missing.length) {
    await update($, form, x => (x ? { ...x, error: `Missing: ${missing.map(m => m.label).join(', ')}` } : x))
    return
  }
  const clean = cleanFields(fields, values)
  const data: Record<string, unknown> = { fields: clean }
  if (noteField && typeof clean[noteField.id] === 'string') data.note = clean[noteField.id]
  const out = await write($, { action: 'done', task: f.task, data })
  return closeOrShow($, out)
}

async function closeOrShow($: $, out: WriterOutcome): Promise<void> {
  if (out.ok) {
    await update($, form, () => null)
    return
  }
  await update($, form, x => (x ? { ...x, error: out.error } : x))
}

async function startTask($: $, task: string): Promise<void> {
  const out = await write($, { action: 'start', task })
  if (!out.ok) {
    $.ui.toast(`Start: ${out.error}`)
    return
  }
  await update($, form, f => (f?.kind === 'pause' ? null : f)) // the pause is over: its reason stays as it was
}

/** Back from done or dropped, with the reason the writer requires (D57). */
async function reopenTask($: $, task: string, why: string): Promise<void> {
  if (!why.trim()) {
    await update($, reopening, x => (x ? { ...x, error: 'Say why first.' } : x))
    return
  }
  const out = await write($, { action: 'reopen', task, data: { why: why.trim() } })
  await update($, reopening, x => (out.ok ? null : x ? { ...x, error: out.error } : x))
}

/** Writes what changed in the card being edited (D61); the writer refuses an emptied start field. */
async function saveEdit($: $, task: string): Promise<void> {
  const ed = await read($, editing)
  const r = await readToday($)
  const card = r.today?.tasks[task]
  if (!ed || !card) return
  const changes = cardChanges(card, ed.values)
  if (Object.keys(changes).length === 0) {
    await update($, editing, () => null)
    return
  }
  const out = await write($, { action: 'task_edit', task, data: { changes } })
  await update($, editing, x => (out.ok ? null : x ? { ...x, error: out.error } : x))
}

async function setPriority($: $, task: string, priority: boolean): Promise<void> {
  const out = await write($, { action: 'task_edit', task, data: { changes: { priority } } })
  if (!out.ok) $.ui.toast(`Priority: ${out.error}`)
}

/** The task goes on alone in a session (D62): the active slot is free for another. */
async function waitTask($: $, task: string): Promise<void> {
  const out = await write($, { action: 'wait', task })
  if (!out.ok) $.ui.toast(`Wait: ${out.error}`)
}

const SESSION_COMMANDS = [
  { name: 'pause', description: "Pause this session's task (a reason may follow: /pause interrupted)", argumentHint: '[reason]' },
  { name: 'resume', description: "Resume this session's paused or waiting task" },
  { name: 'done', description: "Finish this session's task: opens the done row above the prompt" },
  { name: 'wait', description: "Let this session's task (or the one named) run here on its own", argumentHint: '[T#]' },
  { name: 'tasks', description: "Open today's task list" },
] as const

/**
 * The session commands (D64): each acts on THIS session's task and answers in one line, with
 * no model turn. /recap is the engine's own, which the person may run; a plugin may not.
 */
async function sessionCommand($: $, name: string, args: string): Promise<string> {
  if (name === 'tasks') {
    await $.ui.open({ id: PANE, title: 'Today' })
    return "Today's tasks are open."
  }
  const r = await readToday($)
  if (!r.today) return `routine: ${r.problem}`
  const today = r.today
  const own = ownTask(today, await $.session.id())
  const card = own ? today.tasks[own] : undefined
  const alias = own ? aliasOf(today, own) : ''
  if (name === 'wait' && args) {
    const named = resolveTask(today, args)
    if (!named) return `No task ${args} today.`
    const out = await write($, { action: 'wait', task: named })
    return out.ok ? `${aliasOf(today, named)} runs here on its own (waiting).` : `Wait: ${out.error}`
  }
  if (!own || !card) return "No task in this session. Say \"let's do T#\", or /wait T# for a side task."
  if (name === 'pause') {
    if (card.status !== 'active') return `${alias} is ${card.status}: nothing to pause.`
    const reason = args.trim().toLowerCase()
    if (reason && !(PAUSE_REASONS as readonly string[]).includes(reason)) return `Unknown reason "${args}". One of: ${PAUSE_REASONS.join(', ')}.`
    await pauseNow($, own)
    if (!reason) return `Paused ${alias}. Why? Pick it on the band, or /pause <reason> next time.`
    await setReason($, own, reason)
    return `Paused ${alias}: ${reason}.`
  }
  if (name === 'resume') {
    if (card.status === 'active') return `${alias} is already running.`
    await startTask($, own)
    return `Resumed ${alias}.`
  }
  if (name === 'done') {
    await openForm($, own)
    return `Done row for ${alias} is open above the prompt.`
  }
  if (name === 'wait') {
    const out = await write($, { action: 'wait', task: own })
    return out.ok ? `${alias} runs here on its own (waiting).` : `Wait: ${out.error}`
  }
  return `Unknown command /${name}.`
}

/** A break of `minutes`, logged with the rhythm it belongs to (D67, D68). */
async function startBreak($: $, minutes: number, technique: string): Promise<void> {
  await update($, breakPick, () => false)
  const out = await write($, { action: 'break_start', data: { technique, minutes } })
  if (!out.ok) $.ui.toast(`Break: ${out.error}`)
}

/** The rhythm the user picked for the task (D67); "none" keeps no timer (D68). */
async function setTechnique($: $, task: string, technique: string): Promise<void> {
  const out = await write($, { action: 'task_edit', task, data: { changes: { technique } } })
  if (!out.ok) $.ui.toast(`Rhythm: ${out.error}`)
}

async function endBreak($: $, phone: boolean): Promise<void> {
  const out = await write($, { action: 'break_end', data: { phone } })
  if (!out.ok) {
    $.ui.toast(`Break: ${out.error}`)
    return
  }
  await recap($)
}

/**
 * Rebuild today.json from the diary at every load: the band reads that copy, and a copy
 * folded by older code (before a field existed) must not outlive a code change.
 */
async function refreshSnapshot($: $): Promise<void> {
  const s = await settings($)
  if (!s.dataDir) return
  const env: Record<string, string> = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ROUTINE_DATA_DIR: s.dataDir }
  try {
    const ran = await $.process.run([s.python, '-m', 'routine', 'refresh'], { cwd: s.codeDir, env })
    const answer = readWriterAnswer(ran.exitCode, ran.stdout, ran.stderr)
    if (!answer.ok) $.ui.log(`routine: refresh failed: ${answer.error}`, { to: 'debug' })
  } catch (err) {
    $.ui.log(`routine: refresh did not run: ${String(err)}`, { to: 'debug' })
  }
  $.ui.invalidate('ui.render')
}

/** `idle_pause_minutes` from <data>/config/routine.toml, read by the writer's CLI; 0 is off. */
async function idleMinutes($: $): Promise<number> {
  const s = await settings($)
  const env: Record<string, string> = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  if (s.dataDir) env.ROUTINE_DATA_DIR = s.dataDir
  try {
    const ran = await $.process.run([s.python, '-m', 'routine', 'settings'], { cwd: s.codeDir, env })
    const answer = readWriterAnswer(ran.exitCode, ran.stdout, ran.stderr)
    if (!answer.ok) {
      $.ui.log(`routine: no idle pause, settings unreadable: ${answer.error}`, { to: 'debug' })
      return 0 // an unreadable setting never pauses anyone
    }
    const n = (JSON.parse(ran.stdout) as { settings?: { idle_pause_minutes?: unknown } }).settings?.idle_pause_minutes
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : IDLE_DEFAULT_MINUTES
  } catch (err) {
    $.ui.log(`routine: no idle pause, settings did not run: ${String(err)}`, { to: 'debug' })
    return 0
  }
}

/** Checks whether the idle pause is due: pauses with the reason `idle`, or waits the rest. */
async function idleCheck($: $): Promise<void> {
  idleTimer?.cancel()
  idleTimer = undefined
  if (!(await isInteractive($))) return
  const r = await readToday($)
  const minutes = r.today?.active ? await idleMinutes($) : 0
  const due = idleDue(r.today, lastAnswerAt, minutes, await $.clock.now(), await $.session.id())
  if (due.kind === 'wait') {
    idleTimer = $.clock.after(due.ms, () => void idleCheck($))
  } else if (due.kind === 'pause') {
    const out = await write($, { action: 'pause', task: due.task, data: { reason: 'idle' } })
    if (out.ok) $.ui.toast(`Paused after ${minutes} idle minutes. Resume when you are back.`)
  }
}

async function setup($: $): Promise<void> {
  if (isReady || !(await isInteractive($))) return
  isReady = true
  await $.tool.register({
    name: 'routine',
    description:
      "The user's daily routine: one active task at a time. Call it when the user starts, pauses or finishes a task " +
      '("let\'s do T2", "pause", "T2 can run on its own" = wait, "done", "reopen T1"), when a message drifts outside the active task\'s perimeter, ' +
      'to capture an idea to the inbox, or to keep something the user said. "T2" is the 2nd task of today.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'pause', 'wait', 'done', 'reopen', 'edit', 'drift_warn', 'drift_reply', 'inbox', 'said', 'status'],
        },
        task: { type: 'string', description: 'T1, T2... or the task id; default: the active task' },
        note: { type: 'string', description: 'pause/done: what was done, where it stopped, next step (you draft it)' },
        fields: { type: 'object', description: 'done: the configured fields, by id' },
        changes: {
          type: 'object',
          description: 'edit: the card fields to change: title, done_when, first_step, perimeter, kind, project, priority (true/false). The three start fields cannot be emptied.',
        },
        message: { type: 'string', description: 'drift_warn: a short summary of the drifting message' },
        reply: { type: 'string', enum: ['back', 'continue'], description: 'drift_reply' },
        why: { type: 'string', description: 'drift_reply continue, or reopen: the reason the user gave' },
        text: { type: 'string', description: 'inbox / said: the text' },
        kind: { type: 'string', description: 'said: reaction | answer | thought | statement' },
      },
      required: ['action'],
    },
    isDeferred: false,
  })
  await $.command.register({
    name: 'inbox',
    description: 'Capture an idea to the routine inbox without leaving the task',
    argumentHint: '<text>',
    immediate: true,
  })
  // This session's task from its own prompt (D64): a split view shows the band in one pane only.
  for (const command of SESSION_COMMANDS) await $.command.register({ ...command, immediate: true })
  $.clock.every(TICK_MS, () => void tick($))
  await refreshSnapshot($)
  await idleCheck($) // after a load, idleness counts from the diary's last event
}

async function tick($: $): Promise<void> {
  const r = await readToday($)
  const own = r.today ? ownTask(r.today, await $.session.id()) : undefined
  const rh = own && r.today && !r.today.break ? rhythm(r.today, own, await $.clock.now()) : undefined
  if (rh?.due && workToastedFor !== `${own}:${rh.phaseStart}`) {
    workToastedFor = `${own}:${rh.phaseStart}`
    $.ui.toast(`${rh.name}: ${rh.total} minutes of work done. Time for a ${rh.rest}-min break.`)
  }
  const brk = r.today?.break
  if (brk && r.today && band(r.today, await $.clock.now()).break?.isOver && breakToastedFor !== brk.since) {
    breakToastedFor = brk.since
    $.ui.toast('Break over.')
  }
  $.ui.invalidate('ui.render')
}

async function capture($: $, text: string): Promise<string> {
  if (!text) return 'Nothing to capture: /inbox <text>'
  const out = await write($, { action: 'inbox', data: { text } })
  return out.ok ? 'Captured to the inbox.' : `Inbox: ${out.error}`
}

type BandElements =Pick<Elements['terminal' | 'desktop'], 'Box' | 'Text' | 'Button' | 'Input'>

/**
 * The rows under the band line. `openPause` is the reason of the pause still open for the
 * form's task (null: no reason yet), or undefined once that pause is over.
 */
async function formRows($: $, f: RoutineForm, el: BandElements, openPause: string | null | undefined): Promise<RenderElement[]> {
  const { Box, Text, Button, Input } = el
  const rows: RenderElement[] = []
  const setValue = (id: string, v: string | boolean) =>
    update($, form, x => (x ? { ...x, values: { ...x.values, [id]: v }, error: null } : x))
  const noteInput = (id: string, label: string) => (
    <Box key={`row-${id}`}>
      <Input
        key={`field-${id}`}
        label={`${label}: `}
        value={String(f.values[id] ?? f.draft ?? '')}
        placeholder={f.draft === null ? 'drafting...' : 'write the note'}
        onInput={(v: string) => setValue(id, v)}
        onSubmit={(v: string) => setValue(id, v)}
      />
    </Box>
  )
  if (f.kind === 'pause') {
    if (openPause === undefined) return [] // resumed, here or elsewhere: nothing left to ask
    // D56: the task already stopped at the click. A pick is written at once and closes
    // the row; with no pick the pause keeps no reason, and Resume ends it as it is.
    return [
      <Box key="row-reason">
        <Text>Why? </Text>
        {PAUSE_REASONS.map((r, n) => (
          <Button
            key={`field-reason-${n}`}
            label={r}
            variant={openPause === r ? 'primary' : undefined}
            onPress={() => setReason($, f.task, r)}
          />
        ))}
        {f.error ? <Text color="red"> {f.error}</Text> : null}
      </Box>,
    ]
  } else {
    const fields = await doneFields($)
    if (typeof fields === 'string') {
      rows.push(<Box key="fields-error"><Text color="red">{fields}</Text></Box>)
    } else {
      for (const field of fields) {
        if (field.kind === 'text') {
          rows.push(noteInput(field.id, field.label))
          continue
        }
        const options: [string, string | boolean][] =
          field.kind === 'yesno' ? [['yes', true], ['no', false]] : (field.options ?? []).map(o => [o, o])
        rows.push(
          <Box key={`row-${field.id}`}>
            <Text>{field.label} </Text>
            {options.map(([label, value], n) => (
              <Button
                key={`field-${field.id}-${n}`}
                label={label}
                variant={f.values[field.id] === value ? 'primary' : undefined}
                onPress={() => setValue(field.id, value)}
              />
            ))}
          </Box>,
        )
      }
    }
  }
  rows.push(
    <Box key="form-actions">
      <Button key="save" label="Save done" variant="primary" onPress={() => saveForm($)} />
      <Button key="cancel" label="Cancel" onPress={() => update($, form, () => null)} />
      {f.error ? <Text color="red"> {f.error}</Text> : null}
    </Box>,
  )
  return rows
}

export const register: Register = (on, options) => {
  OPTIONS = options
  isReady = false

  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    const res = await next(e)
    await setup($)
    return res
  })

  on('command.run', { command: 'inbox' }, async ($, e) => ({ text: await capture($, e.args.trim()) }))

  on('command.run', { command: 'pause' }, async ($, e) => ({ text: await sessionCommand($, 'pause', e.args.trim()) }))
  on('command.run', { command: 'resume' }, async ($, e) => ({ text: await sessionCommand($, 'resume', e.args.trim()) }))
  on('command.run', { command: 'done' }, async ($, e) => ({ text: await sessionCommand($, 'done', e.args.trim()) }))
  on('command.run', { command: 'wait' }, async ($, e) => ({ text: await sessionCommand($, 'wait', e.args.trim()) }))
  on('command.run', { command: 'tasks' }, async ($, e) => ({ text: await sessionCommand($, 'tasks', e.args.trim()) }))

  on('prompt.submit', async ($, e, next) => {
    if (!(await isInteractive($))) return next(e)
    // The tool and commands are registered at start or attach; after a resume or a reload the
    // attach may come late or not again, so the first interactive prompt makes sure of them.
    await setup($)
    idleTimer?.cancel() // the user is here: no idle pause until the next answer ends
    idleTimer = undefined
    const captured = inboxText(e.text)
    if (captured !== undefined) return { drop: await capture($, captured) }
    const r = await readToday($)
    const added: string[] = []
    // Ask to start the day once per session per day, never on every prompt (G, 2026-10-12).
    const date = localDate(await $.clock.now())
    const ask = r.today || r.problem.startsWith('no diary') ? planDayContext(dayStatus(r.today, date)) : undefined
    if (ask && (await read($, dayAsked)) !== date) {
      added.push(ask)
      await update($, dayAsked, () => date)
    }
    const context = r.today ? promptContext(r.today, TOOL, await $.session.id()) : undefined
    if (context) added.push(context)
    return added.length ? next({ ...e, context: [...(e.context ?? []), ...added] }) : next(e)
  }).catch(($, e, next) => next(e)) // a broken read never blocks the prompt

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId === undefined && (await isInteractive($))) {
      lastAnswerAt = await $.clock.now() // the idle minutes count from the end of this answer (D59)
      await idleCheck($)
    }
    if (!e.usage || !(await isInteractive($))) return res
    const r = await readToday($)
    const own = r.today ? ownTask(r.today, await $.session.id()) : undefined
    const status = own ? r.today?.tasks[own]?.status : undefined
    if (!own || (status !== 'active' && status !== 'waiting')) return res // tokens count for this session's task (D39, D64)
    const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, model } = e.usage
    const data: Record<string, unknown> = {
      input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, model,
    }
    if (e.agentId) data.agent = e.agentId
    await write($, { action: 'usage', task: own, data })
    return res
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
    const action = s('action')
    const r = await readToday($)
    if (!r.today) return { deny: `routine: ${r.problem}` }
    const today = r.today
    if (action === 'status') return { result: taskList(today) || 'No tasks today.' }
    const said = s('task')
    const here = ownTask(today, await $.session.id())
    // A task named ("T2") is that task; unnamed, it is this session's (D64), never another session's.
    const task = said ? resolveTask(today, said) : here
    const done = (out: WriterOutcome, ok: string) => (out.ok ? { result: ok } : { deny: `routine refused: ${out.error}` })

    switch (action) {
      case 'start': {
        if (!said || !task) return { deny: `routine: which task? Today: ${taskList(today)}` }
        const out = await write($, { action: 'start', task })
        const card = today.tasks[task]!
        const note = card.notes?.at(-1) ?? card.last_note
        return done(out, [
          `Started ${aliasOf(today, task)}: ${card.title ?? task}`,
          `Done when: ${card.done_when ?? '-'}`,
          `First step: ${card.first_step ?? '-'}`,
          `Perimeter: ${card.perimeter ?? '-'}`,
          note ? `Last note (read this first): ${note}` : '',
        ].filter(Boolean).join('\n'))
      }
      case 'pause': {
        if (!task) return { deny: 'routine: no task in this session to pause' }
        const note = s('note')?.trim()
        if (!note) return { deny: 'routine: a pause needs a note: what was done, where it stopped, the next step' }
        return done(await write($, { action: 'pause', task, data: { note } }), `Paused ${aliasOf(today, task)}.`)
      }
      case 'wait': {
        // D62/D64: a session works on it alone; from pending it starts here as a side task.
        if (!task) return { deny: 'routine: which task waits? Name it, e.g. T2' }
        return done(await write($, { action: 'wait', task }), `${aliasOf(today, task)} is waiting: the active slot is free.`)
      }
      case 'done': {
        if (!task) return { deny: 'routine: no task in this session to finish; name it, e.g. T2' }
        const fields = await doneFields($)
        if (typeof fields === 'string') return { deny: `routine: ${fields}` }
        const given = (typeof input.fields === 'object' && input.fields) ? { ...(input.fields as Record<string, unknown>) } : {}
        const noteField = fields.find(f => f.kind === 'text')
        if (noteField && given[noteField.id] === undefined && s('note')) given[noteField.id] = s('note')
        const missing = missingFields(fields, given)
        if (missing.length) {
          return { deny: `routine: not saved yet. Ask the user in one message for: ${askFor(missing)}. Then call done again with all fields.` }
        }
        const clean = cleanFields(fields, given)
        const data: Record<string, unknown> = { fields: clean }
        if (noteField && typeof clean[noteField.id] === 'string') data.note = clean[noteField.id]
        return done(await write($, { action: 'done', task, data }), `Done: ${aliasOf(today, task)}.`)
      }
      case 'reopen': {
        // Finished is final (D57): only an explicit task and the user's reason bring it back.
        if (!said || !task) return { deny: `routine: which task? Today: ${taskList(today)}` }
        const why = s('why')?.trim()
        if (!why) return { deny: 'routine: reopening needs why: ask the user for the reason in one line' }
        return done(await write($, { action: 'reopen', task, data: { why } }), `Reopened ${aliasOf(today, task)}: it is pending again.`)
      }
      case 'edit': {
        // D61: the writer checks which fields are editable and that start fields stay filled.
        if (!task) return { deny: `routine: which task? Today: ${taskList(today)}` }
        const changes = typeof input.changes === 'object' && input.changes ? (input.changes as Record<string, unknown>) : {}
        if (Object.keys(changes).length === 0) return { deny: 'routine: edit needs changes, e.g. {"first_step": "..."}' }
        return done(await write($, { action: 'task_edit', task, data: { changes } }), `Edited ${aliasOf(today, task)}: ${Object.keys(changes).join(', ')}.`)
      }
      case 'drift_warn': {
        if (!here) return { deny: 'routine: no task in this session, so nothing to drift from' }
        const message = s('message')?.trim()
        if (!message) return { deny: 'routine: drift_warn needs message' }
        return done(await write($, { action: 'drift_warn', task: here, data: { message } }), 'Drift warning logged. Ask: back to the task, or continue and why?')
      }
      case 'drift_reply': {
        if (!here) return { deny: 'routine: no task in this session' }
        const reply = s('reply')
        const data: Record<string, unknown> = { action: reply }
        if (s('why')) data.why = s('why')
        return done(await write($, { action: 'drift_reply', task: here, data }), reply === 'back' ? 'Back to the task.' : 'Logged: continuing, with the reason.')
      }
      case 'inbox': {
        const text = s('text')?.trim()
        if (!text) return { deny: 'routine: inbox needs text' }
        return done(await write($, { action: 'inbox', data: { text } }), 'Captured to the inbox.')
      }
      case 'said': {
        const text = s('text')?.trim()
        if (!text || !s('kind')) return { deny: 'routine: said needs text and kind' }
        return done(await write($, { action: 'said', data: { text, kind: s('kind') } }), 'Kept.')
      }
      default:
        return { deny: `routine: unknown action ${String(action)}` }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const r = await readToday($)
    if (!r.today) {
      return (
        <Box key="band">
          <Text dimColor>routine · {r.problem}</Text>
        </Box>
      )
    }
    const now = await $.clock.now()
    const session = await $.session.id()
    const b = band(r.today, now, session)
    const f = await read($, form)
    const picking = await read($, breakPick)
    const asOf = <Text dimColor> · data {b.asOf}</Text>

    const day = dayStatus(r.today, localDate(now))
    if (!r.today.open) {
      return (
        <Box key="band">
          <Text dimColor>{day.kind === 'none' ? `${day.date} · no day open today · /plan-day` : `${b.date} · day closed`}</Text>
          {asOf}
        </Box>
      )
    }

    // Two rows laid out against their real width (fitRows): the title gives way first, the
    // phase in words and Tasks never. Two cells spare for what the estimate cannot know.
    const columns = Math.max(20, e.props.bodyColumns - 2)
    const rh = b.task?.rhythm
    const due = rh?.due === true
    const phaseText = (): string | undefined => {
      if (b.break) return b.break.isOver ? 'Break over. Phone during the break?' : `break ${b.break.leftMin}/${b.break.minutes} left`
      if (b.task) {
        if (!rh || rh.kind === 'none') return b.task.elapsed
        if (rh.due) return `time for a ${rh.rest}-min break`
        return rh.kind === 'free' ? `free · ${rh.work}m working` : `${rh.name} · work ${rh.work}/${rh.total}`
      }
      if (b.waiting) return `waiting since ${b.waiting.since}`
      if (b.resume) return 'paused'
      return "say 'let's do T#'"
    }
    const own = b.task ?? b.waiting ?? b.resume
    type Action = BandButton & { onPress: () => unknown; variant?: 'primary' }
    const actions: Action[] = []
    if (b.break) {
      if (b.break.isOver) {
        actions.push({ key: 'phone-yes', label: 'Yes', keep: true, onPress: () => endBreak($, true) })
        actions.push({ key: 'phone-no', label: 'No', keep: true, variant: 'primary', onPress: () => endBreak($, false) })
      } else {
        actions.push({ key: 'phone-no', label: 'End break', keep: true, onPress: () => endBreak($, false) })
      }
    } else {
      if (due && rh) actions.push({ key: 'start-break', label: 'Start break', keep: true, variant: 'primary', onPress: () => startBreak($, rh.rest, rh.technique) })
      if (b.resume) actions.push({ key: 'resume', label: 'Resume', hotkey: 's', variant: 'primary', onPress: () => startTask($, b.resume!.id) })
      if (b.task) actions.push({ key: 'pause', label: 'Pause', hotkey: 'p', onPress: () => pauseNow($, b.task!.id) })
      if (b.task) actions.push({ key: 'done', label: 'Done', hotkey: 'd', onPress: () => openForm($, b.task!.id) })
      if (b.waiting) actions.push({ key: 'done', label: 'Done', hotkey: 'd', onPress: () => openForm($, b.waiting!.id) })
      if (b.task) actions.push({ key: 'wait', label: 'Wait', hotkey: 'w', secondary: true, onPress: () => waitTask($, b.task!.id) })
      if (!due) actions.push({ key: 'break', label: 'Break', hotkey: 'b', secondary: true, onPress: () => update($, breakPick, v => !v) })
      actions.push({ key: 'recap', label: 'Recap', hotkey: 'r', secondary: true, onPress: () => recap($) })
    }
    actions.push({ key: 'tasks', label: 'Tasks', hotkey: 't', keep: true, onPress: () => void $.ui.open({ id: PANE, title: 'Today' }) })
    const phase = phaseText()
    const elsewhere = b.elsewhere ? `now: ${b.elsewhere.alias} ${cut(b.elsewhere.title, 24)} elsewhere` : undefined
    const lay = fitRows(columns, {
      stale: day.kind === 'stale' ? `${day.openDay} still open · /plan-day` : undefined,
      date: b.date,
      progress: b.progress,
      progressShort: shortProgress(r.today),
      title: b.break?.isOver ? '' : own ? `${own.alias} ${own.title}` : 'no task in this session',
      phase,
      buttons: actions,
      extra: elsewhere,
      asOf: `data ${b.asOf}`,
      asOfShort: b.asOf,
    })
    // Row 1: where this session is. Row 2: what it can do, every button with its key.
    const info = (
      <Box key="line" columnGap={1} flexWrap="nowrap">
        {day.kind === 'stale' ? <Text color="yellow">{`${day.openDay} still open · /plan-day`}</Text> : null}
        {lay.info.date ? <Text dimColor>{b.date}</Text> : null}
        {lay.info.progress ? <Text dimColor>{lay.info.progress === 'long' ? b.progress : shortProgress(r.today)}</Text> : null}
        {lay.info.date || lay.info.progress ? <Text dimColor>{'·'}</Text> : null}
        {lay.info.title ? <Text bold={!!b.task} dimColor={!b.task && !b.waiting}>{lay.info.title}</Text> : null}
        {lay.info.title && phase ? <Text dimColor>{'·'}</Text> : null}
        {phase ? <Text bold={!!b.task && !due} color={due ? 'yellow' : undefined} dimColor={!!b.resume || (!own && !b.break)}>{phase}</Text> : null}
        {lay.info.extra && elsewhere ? <Text dimColor>{elsewhere}</Text> : null}
      </Box>
    )
    const buttons = (
      <Box key="actions" columnGap={1} flexWrap="nowrap">
        {actions.filter(a => !lay.actions.dropped.includes(a.key)).map(a => (
          <Button
            key={a.key}
            label={buttonLabel(a, lay.actions.compact)}
            {...(a.hotkey && !(lay.actions.compact && !a.keep) ? { hotkey: a.hotkey } : {})}
            {...(a.variant ? { variant: a.variant } : {})}
            onPress={a.onPress}
          />
        ))}
        <Text dimColor>{lay.actions.asOf === 'long' ? `data ${b.asOf}` : b.asOf}</Text>
      </Box>
    )

    const rows = [info, buttons]
    if (picking && !b.break) {
      const suggested = b.task?.rhythm?.rest || BREAK_MINUTES[0]
      const technique = b.task?.rhythm?.technique ?? 'none'
      rows.push(
        <Box key="breaks" columnGap={1}>
          <Text dimColor>Break:</Text>
          {BREAK_MINUTES.map((minutes, n) => (
            <Button key={`break-${n}`} label={`${minutes} min`} variant={minutes === suggested ? 'primary' : undefined} onPress={() => startBreak($, minutes, technique)} />
          ))}
        </Box>,
      )
    }
    if (b.task?.rhythm?.unchosen && !b.break) {
      // First start with no rhythm (D67): one row, pomodoro suggested; no timer until a pick (D68).
      const task = b.task.id
      rows.push(
        <Box key="techniques" columnGap={1}>
          <Text dimColor>{`Rhythm for ${b.task.alias}:`}</Text>
          {TECHNIQUES.map((technique, n) => (
            <Button key={`technique-${n}`} label={technique === 'none' ? 'no timer' : technique} variant={n === 0 ? 'primary' : undefined} onPress={() => setTechnique($, task, technique)} />
          ))}
        </Box>,
      )
    }
    const openPause = b.resume && f?.task === b.resume.id ? b.resume.reason : undefined
    if (f) rows.push(...(await formRows($, f, { Box, Text, Button, Input }, openPause)))
    return <Box key="band" flexDirection="column">{rows}</Box>
  })

  // This session's task as a footer chip (D64): Desktop draws SessionMode in every pane of a
  // split view, where it draws the band only in the active one. Added to the engine's modes.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const r = await readToday($)
    const session = await $.session.id()
    const chip = sessionChip(r.today, session, await $.clock.now())
    if (!chip) return next(e)
    if (e.surface !== 'desktop') return next({ ...e, props: { ...e.props, modes: [...e.props.modes, chip] } })
    // Desktop keeps a Button in the chip and makes it clickable in every pane (it cannot take
    // the keyboard: only Pane and AbovePrompt hold focus), so the chip acts on THIS session.
    const { Box, Text, Button } = $.ui.resolve(e)
    const own = r.today ? ownTask(r.today, session) : undefined
    const status = own ? r.today?.tasks[own]?.status : undefined
    return (
      <Box key="chip">
        <Text>{[...e.props.modes, chip].join(' & ')}</Text>
        {own && status === 'active' && <Button key="chip-pause" label="pause" onPress={() => pauseNow($, own)} />}
        {own && status === 'paused' && (
          <Button key="chip-resume" label="resume" onPress={() => startTask($, own)} />
        )}
        {own && <Button key="chip-recap" label="recap" onPress={() => recap($)} />}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Asking the reason needs a text field, which every surface but the phone has.
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const asking = await read($, reopening)
    const session = await $.session.id()
    const ed = await read($, editing)
    const r = await readToday($)
    if (!r.today) return <Box key="tasks"><Text dimColor>{r.problem}</Text></Box>
    const today = r.today
    const rows = taskRows(today)
    const inbox = Object.keys(today.inbox).length
    return (
      <Box key="tasks" flexDirection="column">
        <Box key="pane-head" columnGap={1}>
          <Text dimColor>{today.day} · {band(today, await $.clock.now()).progress} · inbox {inbox} · data {clockOf(today.last_ts)}</Text>
          {today.open && <Button key="pane-break" label="Break" onPress={() => update($, breakPick, v => !v)} />}
          <Button key="pane-recap" label="Recap" onPress={() => recap($)} />
        </Box>
        {rows.length === 0 && <Text dimColor>No tasks today.</Text>}
        {rows.map(row => (
          <Box key={`task-${row.id}`} flexDirection="column">
            <Box key={`head-${row.id}`}>
              <Text bold={row.action === 'done'}>{row.mark} {row.alias} {row.priority ? '★ ' : ''}{row.title}{row.carried ? ` · carried ${row.carried}x` : ''}{today.tasks[row.id]?.session === session && row.action !== 'reopen' ? ' · here' : ''} </Text>
              {row.action === 'start' && today.open && (
                <Button key={`start-${row.id}`} label="Start" onPress={() => startTask($, row.id)} />
              )}
              {row.action === 'done' && (
                <Button key={`done-${row.id}`} label="Done" variant="primary" onPress={() => openForm($, row.id)} />
              )}
              {row.canWait && <Button key={`wait-${row.id}`} label="Wait" onPress={() => waitTask($, row.id)} />}
              {row.action !== 'reopen' && Input && ed?.task !== row.id && (
                <Button key={`edit-${row.id}`} label="Edit" onPress={() => update($, editing, () => ({ task: row.id, values: {}, error: null }))} />
              )}
              {row.priority && row.action !== 'reopen' && (
                <Button key={`unprioritize-${row.id}`} label="Unset priority" onPress={() => setPriority($, row.id, false)} />
              )}
              {row.action === 'reopen' && today.open && Input && (
                <Button key={`reopen-${row.id}`} label="Reopen" onPress={() => update($, reopening, () => ({ task: row.id, error: null }))} />
              )}
            </Box>
            {Input && ed?.task === row.id && (
              <Box key={`editing-${row.id}`} flexDirection="column">
                {PANE_EDIT_FIELDS.map(([field, label]) => (
                  <Input
                    key={`edit-${field}-${row.id}`}
                    label={`    ${label}: `}
                    value={ed.values[field] ?? String(today.tasks[row.id]?.[field] ?? '')}
                    onInput={(v: string) => update($, editing, x => (x ? { ...x, values: { ...x.values, [field]: v }, error: null } : x))}
                    onSubmit={(v: string) => update($, editing, x => (x ? { ...x, values: { ...x.values, [field]: v }, error: null } : x))}
                  />
                ))}
                <Box key={`edit-actions-${row.id}`} columnGap={1}>
                  <Text>    </Text>
                  <Button key={`edit-save-${row.id}`} label="Save" variant="primary" onPress={() => saveEdit($, row.id)} />
                  <Button key={`edit-cancel-${row.id}`} label="Cancel" onPress={() => update($, editing, () => null)} />
                  {ed.error ? <Text color="red">{ed.error}</Text> : null}
                </Box>
              </Box>
            )}
            {Input && asking?.task === row.id && (
              <Box key={`why-${row.id}`}>
                <Input key={`reopen-why-${row.id}`} label="    Why reopen? " placeholder="the reason" onSubmit={(v: string) => reopenTask($, row.id, v)} />
                <Button key={`reopen-cancel-${row.id}`} label="Cancel" onPress={() => update($, reopening, () => null)} />
                {asking.error ? <Text color="red"> {asking.error}</Text> : null}
              </Box>
            )}
            {row.waitingSince && <Text dimColor>    waiting since {row.waitingSince}</Text>}
            {row.doneWhen && <Text dimColor>    done when: {row.doneWhen}</Text>}
            {row.firstStep && <Text dimColor>    first step: {row.firstStep}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
