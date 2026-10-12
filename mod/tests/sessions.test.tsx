// D64: the band belongs to its session. One day, four sessions reading the same today.json:
// A was on T1 (paused when T2 started in B), B is on T2, C works on the slow priority T3 as a
// side task (waiting), D has no task. Each sees its own task; the day's active one, if it is
// elsewhere, only dimmed.
import { expect, test } from 'claude-code/testing'

import type { Today } from '../hooks/core'
import { writerArgv } from '../hooks/core'
import { BAND_PROPS, CWD, OPTIONS, PYTHON, START, prompt, today, world, writes } from './world'

const TOOL = 'mcp__routine__routine'
const [T1, T2, T3, T4] = ['t-1', 't-2', 't-3', 't-4']
const CARD = { done_when: 'it is written', first_step: 'open it', perimeter: 'this text only', notes: [] }
const MIN = 60_000
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }

function day(): Today {
  return today({
    order: [T1, T2, T3, T4],
    tasks: {
      [T1]: { id: T1, title: 'Write the intro', status: 'paused', session: 'A', ...CARD, pauses: [{ at: '2026-10-12T09:00:00+02:00', reason: 'switched' }] },
      [T2]: { id: T2, title: 'Read section 3', status: 'active', session: 'B', since: '2026-10-12T09:00:00+02:00', ...CARD },
      [T3]: { id: T3, title: 'Slow priority', status: 'waiting', session: 'C', waiting_since: '2026-10-12T09:10:00+02:00', priority: true, ...CARD },
      [T4]: { id: T4, title: 'Side job', status: 'pending', ...CARD },
    },
    active: T2,
    last_paused: T1,
  })
}

function band(columns = 120) {
  return { plugin: 'routine', component: 'AbovePrompt', props: { ...(BAND_PROPS as object), bodyColumns: columns } as never } as const
}

async function text(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  const parts: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === 'string') parts.push(n)
    else if (n && typeof n === 'object') {
      const o = n as { children?: unknown[]; props?: { label?: string } }
      if (o.props?.label) parts.push(`[${o.props.label}]`)
      for (const c of o.children ?? []) walk(c)
    }
  }
  walk(await ui.drawn())
  return parts.join(' ').replace(/\s+/g, ' ')
}

/** What the mod must send from `session` (the writer binds the task there, D64). */
function from(session: string, action: Parameters<typeof writerArgv>[1]['action'], task: string, data: Record<string, unknown> = {}) {
  return writerArgv(PYTHON, { action, task, data, session, cwd: CWD })
}

test('D64: each session sees its own task on the band; the day\'s active one elsewhere only dimmed', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  const seen: Record<string, string> = {}
  for (const session of ['A', 'B', 'C', 'D']) {
    w.session = session
    const ui = await $.ui.mount({ ...band(140), surface: 'desktop' })
    seen[session] = await text(ui)
    await ui.unmount()
  }
  expect(seen.A).toContain('T1 Write the intro · paused now: T2 Read section 3 elsewhere [Resume]')
  expect(seen.A).not.toContain('[Pause]')
  expect(seen.B).toContain('T2 Read section 3 · 41m [Pause] [Done] [Wait]')
  expect(seen.B).not.toContain('elsewhere')
  expect(seen.C).toContain('T3 Slow priority · waiting since 09:10 now: T2 Read section 3 elsewhere [Done]')
  expect(seen.C).toContain('now: T2 Read section 3 elsewhere')
  expect(seen.D).toContain("no task in this session · say 'let's do T#'")
  expect(seen.D).toContain('now: T2 Read section 3 elsewhere')
  expect(seen.D).not.toContain('[Done]')
})

test('D64: narrow, the other session\'s task gives way before this session\'s own', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  w.session = 'A'
  const line = await text(await $.ui.mount({ ...band(56), surface: 'terminal' }))
  expect(line).toContain('T1 Write the intro · paused [Resume]')
  expect(line).not.toContain('elsewhere')
})

test('D64: each session\'s context is its own task; another session\'s is only named', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  const context = async (session: string) => {
    w.session = session
    return ((await $.prompt.submit(prompt('next?'))).context ?? []).join('\n')
  }
  const a = await context('A')
  expect(a).toContain("The day's active task is T2, in another session")
  expect(a).toContain("This session's task T1 is paused")
  expect(a).not.toContain('Perimeter')
  const c = await context('C')
  expect(c).toContain('Side task T3 (waiting: this session works on it on its own): Slow priority')
  expect(c).toContain('Perimeter (what counts as related): this text only')
  expect(c).toContain('drift_warn')
  const b = await context('B')
  expect(b).toContain('Active task T2: Read section 3')
  expect(b).not.toContain('another session')
  expect(await context('D')).toContain('No task in this session')
})

test('D64: buttons and the tool act on this session\'s task, never on another session\'s', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  w.session = 'B'
  await (await $.ui.mount({ ...band(), surface: 'desktop' })).press({ key: 'pause' })
  w.session = 'C'
  const { note, ...fields } = { rating: '😐', drifted: false, note: 'slow part done' }
  await $.tool.call({ tool: TOOL, action: 'done', fields, note } as never)
  w.session = 'A'
  await $.tool.call({ tool: TOOL, action: 'drift_warn', message: 'off topic' } as never)
  expect(writes(w)).toEqual([
    from('B', 'pause', T2),
    from('C', 'done', T3, { fields: { rating: '😐', drifted: false, note: 'slow part done' }, note: 'slow part done' }),
    from('A', 'drift_warn', T1, { message: 'off topic' }),
  ])
})

test('D64: a slow side task starts in its own session straight from pending, with wait', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  w.session = 'D'
  await $.tool.call({ tool: TOOL, action: 'wait', task: 'T4' } as never)
  expect(writes(w)).toEqual([from('D', 'wait', T4)])
})

test('D64: tokens count for the session\'s own task while it is worked on, never the day\'s active one', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  for (const session of ['A', 'B', 'C', 'D']) {
    w.session = session
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: session, reason: 'answer', usage: USAGE } as never)
  }
  expect(writes(w).filter(a => a[3] === 'usage').map(a => [a[a.indexOf('--session') + 1], a[a.indexOf('--task') + 1]])).toEqual([
    ['B', T2],
    ['C', T3],
  ])
})

test('D64: only the session working on the active task pauses it for idleness', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  w.session = 'A'
  await $.session.start(START)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a', reason: 'answer', usage: USAGE } as never)
  await w.clock.advance(60 * MIN)
  expect(writes(w).filter(a => a[3] === 'pause')).toEqual([])
})

test('D64: a session whose task just finished, with no active task and a side task elsewhere, still draws its band', { options: OPTIONS }, async ($, on) => {
  // The lead session's state on 12-oct: its T9 done, T4 waiting in another session, nothing active.
  const t = day()
  t.tasks[T2] = { ...t.tasks[T2]!, status: 'done', session: 'E' }
  delete t.tasks[T2]!.since
  t.active = null
  const w = world(on, { today: t })
  await $.session.start(START)
  w.session = 'E'
  for (const surface of ['terminal', 'desktop'] as const) {
    const line = await text(await $.ui.mount({ ...band(), surface }))
    expect(line).toContain("no task in this session · say 'let's do T#'")
    expect(line).toContain('[Tasks]')
    expect(line).not.toContain('elsewhere')
  }
})

