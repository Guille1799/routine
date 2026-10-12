// The routine mod: one copy runs per session. It never writes a file itself:
// every change goes through the single writer, `python -m routine <action>`
// (D35), and every read is a fresh read of <data>/state/today.json.
import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, PluginOptions, Register, RenderElement } from 'claude-code'

import type { RoutineForm } from '../types'
import {
  BREAKS,
  PAUSE_REASONS,
  askFor,
  band,
  bandFit,
  clockOf,
  cleanFields,
  dayStatus,
  IDLE_DEFAULT_MINUTES,
  idleDue,
  inboxText,
  localDate,
  missingFields,
  planDayContext,
  promptContext,
  readWriterAnswer,
  resolveTask,
  shortProgress,
  aliasOf,
  taskList,
  taskRows,
  writerArgv,
} from './core'
import type { DoneField, Today, WriterCall, WriterOutcome } from './core'

type $ = EngineInterface

export const TOOL = 'mcp__routine__routine'
export const PANE = 'routine-tasks'
const TICK_MS = 30_000

const form = atom({ plugin: 'routine', key: 'form' } as const, null)
const breakPick = atom({ plugin: 'routine', key: 'breakPick' } as const, false)
const dayAsked = atom({ plugin: 'routine', key: 'dayAsked' } as const, null)
const reopening = atom({ plugin: 'routine', key: 'reopen' } as const, null)

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
async function pauseNow($: $): Promise<void> {
  const r = await readToday($)
  if (!r.today?.active) {
    $.ui.toast(r.problem ?? 'No active task.')
    return
  }
  const task = r.today.active
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

async function openForm($: $, kind: 'done'): Promise<void> {
  const r = await readToday($)
  if (!r.today?.active) {
    $.ui.toast(r.problem ?? 'No active task.')
    return
  }
  const fields = await doneFields($)
  if (typeof fields === 'string') {
    $.ui.toast(fields)
    return
  }
  const needsDraft = fields.some(f => f.kind === 'text' && f.prefill === 'session')
  await update($, form, () => ({ kind, task: r.today.active!, values: {}, draft: needsDraft ? null : '', error: null }))
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

async function startBreak($: $, n: number): Promise<void> {
  const choice = BREAKS[n] ?? BREAKS[0]!
  await update($, breakPick, () => false)
  const out = await write($, { action: 'break_start', data: { technique: choice.technique, minutes: choice.minutes } })
  if (!out.ok) $.ui.toast(`Break: ${out.error}`)
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
  const due = idleDue(r.today, lastAnswerAt, minutes, await $.clock.now())
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
      '("let\'s do T2", "pause", "done", "reopen T1"), when a message drifts outside the active task\'s perimeter, ' +
      'to capture an idea to the inbox, or to keep something the user said. "T2" is the 2nd task of today.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'pause', 'done', 'reopen', 'drift_warn', 'drift_reply', 'inbox', 'said', 'status'],
        },
        task: { type: 'string', description: 'T1, T2... or the task id; default: the active task' },
        note: { type: 'string', description: 'pause/done: what was done, where it stopped, next step (you draft it)' },
        fields: { type: 'object', description: 'done: the configured fields, by id' },
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
  $.clock.every(TICK_MS, () => void tick($))
  await refreshSnapshot($)
  await idleCheck($) // after a load, idleness counts from the diary's last event
}

async function tick($: $): Promise<void> {
  const r = await readToday($)
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

  on('prompt.submit', async ($, e, next) => {
    if (!(await isInteractive($))) return next(e)
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
    const context = r.today ? promptContext(r.today, TOOL) : undefined
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
    if (!r.today?.active) return res
    const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, model } = e.usage
    const data: Record<string, unknown> = {
      input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, model,
    }
    if (e.agentId) data.agent = e.agentId
    await write($, { action: 'usage', task: r.today.active, data })
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
    const task = resolveTask(today, said)
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
        if (!task) return { deny: 'routine: no active task to pause' }
        const note = s('note')?.trim()
        if (!note) return { deny: 'routine: a pause needs a note: what was done, where it stopped, the next step' }
        return done(await write($, { action: 'pause', task, data: { note } }), `Paused ${aliasOf(today, task)}.`)
      }
      case 'done': {
        if (!task) return { deny: 'routine: no active task to finish' }
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
      case 'drift_warn': {
        if (!today.active) return { deny: 'routine: no active task, so nothing to drift from' }
        const message = s('message')?.trim()
        if (!message) return { deny: 'routine: drift_warn needs message' }
        return done(await write($, { action: 'drift_warn', task: today.active, data: { message } }), 'Drift warning logged. Ask: back to the task, or continue and why?')
      }
      case 'drift_reply': {
        if (!today.active) return { deny: 'routine: no active task' }
        const reply = s('reply')
        const data: Record<string, unknown> = { action: reply }
        if (s('why')) data.why = s('why')
        return done(await write($, { action: 'drift_reply', task: today.active, data }), reply === 'back' ? 'Back to the task.' : 'Logged: continuing, with the reason.')
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
    const b = band(r.today, now)
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
    const stale = day.kind === 'stale' ? <Text color="yellow">{day.openDay} still open · /plan-day</Text> : null

    const fit = bandFit(e.props.bodyColumns)
    const dot = <Text dimColor>·</Text>
    const asOfShort = <Text dimColor>{fit.asOf === 'long' ? `data ${b.asOf}` : b.asOf}</Text>
    const head = [
      stale,
      fit.date ? <Text dimColor>{b.date}</Text> : null,
      fit.progress ? <Text dimColor>{fit.progress === 'long' ? b.progress : shortProgress(r.today)}</Text> : null,
    ].filter(x => x !== null)
    let line
    if (b.break) {
      line = b.break.isOver ? (
        <Box key="line" columnGap={1}>
          <Text>{fit.date ? 'Break over. Phone during the break?' : 'Phone in the break?'}</Text>
          <Button key="phone-yes" label="Yes" onPress={() => endBreak($, true)} />
          <Button key="phone-no" label="No" variant="primary" onPress={() => endBreak($, false)} />
          {asOfShort}
        </Box>
      ) : (
        <Box key="line" columnGap={1}>
          {head}
          <Text>{`break: ${b.break.leftMin}m left`}</Text>
          <Button key="phone-no" label="End break" onPress={() => endBreak($, false)} />
          {asOfShort}
        </Box>
      )
    } else {
      const due = b.task?.breakDue === true
      line = (
        <Box key="line" columnGap={1} flexWrap="nowrap">
          {head}
          {head.length > 0 ? dot : null}
          {b.task ? (
            <Box key="task" columnGap={1} flexShrink={1}>
              <Text bold wrap="truncate-end">{b.task.alias} {b.task.title}</Text>
              {b.task.elapsed ? <Text bold>{b.task.elapsed}</Text> : null}
            </Box>
          ) : b.resume ? (
            <Text dimColor wrap="truncate-end">{b.resume.alias} {b.resume.title} · paused</Text>
          ) : (
            <Text dimColor>no active task</Text>
          )}
          {b.resume && <Button key="resume" label="Resume" hotkey="s" variant="primary" onPress={() => startTask($, b.resume!.id)} />}
          {b.task && <Button key="pause" label="Pause" hotkey="p" onPress={() => pauseNow($)} />}
          {b.task && <Button key="done" label="Done" hotkey="d" onPress={() => openForm($, 'done')} />}
          {(fit.break === 'always' || due) && (
            <Button
              key="break"
              label={due && fit.date ? 'Break (25m up)' : 'Break'}
              hotkey="b"
              variant={due ? 'primary' : undefined}
              onPress={() => update($, breakPick, v => !v)}
            />
          )}
          {fit.recap && <Button key="recap" label="Recap" hotkey="r" onPress={() => recap($)} />}
          {fit.tasks && <Button key="tasks" label="Tasks" hotkey="t" onPress={() => void $.ui.open({ id: PANE, title: 'Today' })} />}
          {asOfShort}
        </Box>
      )
    }

    const rows = [line]
    if (picking && !b.break) {
      rows.push(
        <Box key="breaks">
          <Text dimColor>Break: </Text>
          {BREAKS.map((choice, n) => (
            <Button key={`break-${n}`} label={choice.label} variant={n === 0 ? 'primary' : undefined} onPress={() => startBreak($, n)} />
          ))}
        </Box>,
      )
    }
    const openPause = b.resume && f?.task === b.resume.id ? b.resume.reason : undefined
    if (f) rows.push(...(await formRows($, f, { Box, Text, Button, Input }, openPause)))
    return <Box key="band" flexDirection="column">{rows}</Box>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Asking the reason needs a text field, which every surface but the phone has.
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const asking = await read($, reopening)
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
              <Text bold={row.action === 'done'}>{row.mark} {row.alias} {row.title}{row.carried ? ` · carried ${row.carried}x` : ''} </Text>
              {row.action === 'start' && today.open && (
                <Button key={`start-${row.id}`} label="Start" onPress={() => startTask($, row.id)} />
              )}
              {row.action === 'done' && (
                <Button key={`done-${row.id}`} label="Done" variant="primary" onPress={() => openForm($, 'done')} />
              )}
              {row.action === 'reopen' && today.open && Input && (
                <Button key={`reopen-${row.id}`} label="Reopen" onPress={() => update($, reopening, () => ({ task: row.id, error: null }))} />
              )}
            </Box>
            {Input && asking?.task === row.id && (
              <Box key={`why-${row.id}`}>
                <Input key={`reopen-why-${row.id}`} label="    Why reopen? " placeholder="the reason" onSubmit={(v: string) => reopenTask($, row.id, v)} />
                <Button key={`reopen-cancel-${row.id}`} label="Cancel" onPress={() => update($, reopening, () => null)} />
                {asking.error ? <Text color="red"> {asking.error}</Text> : null}
              </Box>
            )}
            {row.doneWhen && <Text dimColor>    done when: {row.doneWhen}</Text>}
            {row.firstStep && <Text dimColor>    first step: {row.firstStep}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
