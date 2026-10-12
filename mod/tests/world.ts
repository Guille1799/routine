// A fake world beneath the mod: today.json, the writer process, the session.
// The mod under test is the real one; only what lies beneath `$` is stood in.
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { DoneField, Today, WriterCall } from '../hooks/core'
import { writerArgv } from '../hooks/core'

export const PYTHON = 'py'
export const DATA = 'D:/routine-data'
export const SESSION = 'session-1'
export const CWD = 'D:/work/project'
export const OPTIONS = { dataDir: DATA, python: PYTHON, codeDir: 'D:/routine' }

// 09:41 on the 12th, +02:00
export const NOW = Date.parse('2026-10-12T09:41:00+02:00')

export const EXAMPLE_FIELDS: DoneField[] = [
  { id: 'rating', label: 'How was it?', kind: 'buttons', options: ['🔥', '😐', '🥱'], required: true },
  { id: 'learned_how', label: 'How did you learn?', kind: 'buttons', options: ['reading', 'doing it with Claude', 'video', 'Claude quizzed me'] },
  { id: 'drifted', label: 'Did you drift?', kind: 'yesno', required: true },
  { id: 'phone', label: 'Phone or distractions?', kind: 'yesno' },
  { id: 'note', label: 'Done / stopped at / next / I take away', kind: 'text', prefill: 'session', required: true },
]

/**
 * Today's read model, consistent as the writer folds it: the task named `active` is
 * active and this session's (D64); any other task the fixture had active is paused.
 */
export function today(over: Partial<Today> = {}): Today {
  const t = base(over)
  if (over.tasks) return t
  for (const id of t.order) {
    const card = t.tasks[id]!
    if (id !== t.active && card.status === 'active') {
      const { since: _since, ...rest } = card
      t.tasks[id] = { ...rest, status: 'paused' }
    }
  }
  if (t.active && t.tasks[t.active]?.status !== 'active') {
    t.tasks[t.active] = { ...t.tasks[t.active]!, status: 'active', session: SESSION, since: '2026-10-12T09:30:00+02:00' }
  }
  return t
}

function base(over: Partial<Today>): Today {
  return {
    day: '2026-10-12',
    open: true,
    closed: false,
    mode: 'normal',
    order: ['t-20261012-aaaaaa', 't-20261012-bbbbbb', 't-20261012-cccccc'],
    tasks: {
      't-20261012-aaaaaa': { id: 't-20261012-aaaaaa', title: 'Answer two mails', status: 'done', notes: [] },
      't-20261012-bbbbbb': {
        id: 't-20261012-bbbbbb', title: 'Read section 3', status: 'active', since: '2026-10-12T09:00:00+02:00', session: SESSION, technique: 'none',
        done_when: 'notes written', first_step: 'open the pdf', perimeter: 'questions about the text, unknown terms',
        notes: ['read 3.1; next 3.2'],
      },
      't-20261012-cccccc': {
        id: 't-20261012-cccccc', title: 'Fix the parser', status: 'pending',
        done_when: 'tests pass', first_step: 'run the tests', perimeter: 'the parser and its tests',
      },
    },
    active: 't-20261012-bbbbbb',
    inbox: {},
    break: null,
    drift: {},
    last_ts: '2026-10-12T09:41:00+02:00',
    ...over,
  }
}

export type World = {
  /** today.json as the writer last wrote it; undefined = no diary yet. */
  today: Today | undefined
  dataExists: boolean
  surfaces: string[]
  fields: DoneField[] | { exit: number; error: string }
  /** What `python -m routine settings` answers (routine.toml with defaults applied). */
  settings: { idle_pause_minutes: number } | { exit: number; error: string }
  commands: { name: string; source: 'builtin' | 'plugin' | 'user' | 'mcp' }[]
  fork: string | 'nothing-to-fork'
  /** Exit code the writer answers next (0 written, 1 refused). */
  writerExit: number
  // what happened
  runs: string[][]
  registeredTools: string[]
  registeredCommands: string[]
  ranCommands: string[]
  forks: string[]
  logs: string[]
  toasts: string[]
  opened: string[]
  /** The session the engine says this is (D64): change it to stand for another session. */
  session: string
  /** The mocked clock, to move to another day. */
  clock: MockClock
}

/** The argv the mod must send for a contract call, in this world's session. */
export function argvOf(call: WriterCall, task?: string): string[] {
  return writerArgv(PYTHON, {
    ...call,
    task: call.task === '$task' ? task : call.task,
    session: SESSION,
    cwd: CWD,
  })
}

/** Writer runs only: the `fields` and `settings` reads and the load-time `refresh` left out. */
export function writes(w: World): string[][] {
  return w.runs.filter(a => !['fields', 'settings', 'refresh'].includes(a[3] ?? ''))
}

/** The load-time rebuilds of today.json. */
export function refreshes(w: World): string[][] {
  return w.runs.filter(a => a[3] === 'refresh')
}

/** The engine hands paths in the platform's spelling. */
const slash = (p: string) => p.replace(/\\/g, '/')

export function world(on: On, over: Partial<World> = {}): World {
  const w: World = {
    today: today(),
    dataExists: true,
    surfaces: ['desktop'],
    fields: EXAMPLE_FIELDS,
    settings: { idle_pause_minutes: 20 },
    commands: [],
    fork: 'drafted note',
    writerExit: 0,
    runs: [],
    registeredTools: [],
    registeredCommands: [],
    ranCommands: [],
    forks: [],
    logs: [],
    toasts: [],
    opened: [],
    session: SESSION,
    clock: undefined as unknown as MockClock,
    ...over,
  }
  w.clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  on('session.surfaces', () => ({ value: w.surfaces as never }))
  on('session.id', () => ({ value: w.session }))
  on('session.cwd', () => ({ value: CWD }))
  on('fs.read', ($, e) => {
    if (slash(e.path) === `${DATA}/state/today.json` && w.today) return { value: JSON.stringify(w.today) }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('fs.stat', ($, e) =>
    slash(e.path) === DATA && w.dataExists
      ? { value: { kind: 'directory', size: 0, mtimeMs: 0, isLink: false } as never }
      : { deny: `ENOENT: ${e.path}` },
  )
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    const answer = (exitCode: number, stdout: string) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (argv[3] === 'settings') {
      if ('exit' in w.settings) return answer(w.settings.exit, JSON.stringify({ ok: false, error: w.settings.error }))
      return answer(0, JSON.stringify({ ok: true, settings: w.settings }))
    }
    if (argv[3] === 'fields') {
      if (Array.isArray(w.fields)) return answer(0, JSON.stringify({ ok: true, fields: w.fields }))
      return answer(w.fields.exit, JSON.stringify({ ok: false, error: w.fields.error }))
    }
    if (w.writerExit !== 0) return answer(w.writerExit, JSON.stringify({ ok: false, error: 'refused by the writer' }))
    return answer(0, JSON.stringify({ ok: true, events: [] }))
  })
  on('tool.register', ($, e) => {
    w.registeredTools.push(e.name)
    return { value: { tool: `mcp__routine__${e.name}` } }
  })
  on('command.register', ($, e) => {
    w.registeredCommands.push(e.name)
    return { value: { command: e.name } }
  })
  on('command.list', () => ({ value: w.commands.map(c => ({ ...c, description: '' })) }))
  on('command.run', ($, e) => {
    w.ranCommands.push(e.command)
    return { text: '' }
  })
  on('model.fork', ($, e) => {
    w.forks.push(e.prompt)
    if (w.fork === 'nothing-to-fork') return { value: { isAnswered: false, reason: 'nothing-to-fork' } as never }
    return {
      value: {
        isAnswered: true, text: w.fork,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as never,
    }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } as never }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.attach', () => ({ clientId: 'c1' }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  return w
}

export const START = { cwd: CWD, surface: null, isInteractive: false } as const

export const BAND_PROPS = {
  hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120,
  scroll: { bodyRows: 11, offset: 0 }, view: {},
} as never

export const PANE_PROPS = {
  title: 'Today', isFocused: false, bodyColumns: 80, placement: 'dock',
  scroll: { bodyRows: 20, offset: 0 }, view: {},
} as never

export function prompt(text: string) {
  return { text, wait: false, origin: { kind: 'composer' } } as never
}
