// D64, per pane: Desktop draws the AbovePrompt band only in the active pane of a split view,
// but the prompt footer's SessionMode chip in every pane. The chip says this session's task
// and, on desktop, carries clickable buttons; the session commands act on it from its prompt.
import { expect, test } from 'claude-code/testing'

import type { Today } from '../hooks/core'
import { writerArgv } from '../hooks/core'
import { BAND_PROPS, CWD, OPTIONS, PYTHON, START, today, world, writes } from './world'

const [T1, T2, T3, T4] = ['t-1', 't-2', 't-3', 't-4']
const CARD = { done_when: 'it is written', first_step: 'open it', perimeter: 'this text only', notes: [] }
const CHIP = { plugin: 'routine', component: 'SessionMode', requestId: 'session-mode' } as const

/** A on T1 (paused), B on T2 (active), C on T3 (a side task, waiting), D on nothing. */
function day(): Today {
  return today({
    order: [T1, T2, T3, T4],
    tasks: {
      [T1]: { id: T1, title: 'Write the intro', status: 'paused', session: 'A', ...CARD, pauses: [{ at: '2026-10-12T09:00:00+02:00', reason: null }] },
      [T2]: { id: T2, title: 'Read section 3', status: 'active', session: 'B', since: '2026-10-12T09:00:00+02:00', ...CARD },
      [T3]: { id: T3, title: 'Slow priority', status: 'waiting', session: 'C', waiting_since: '2026-10-12T09:10:00+02:00', ...CARD },
      [T4]: { id: T4, title: 'Side job', status: 'pending', ...CARD },
    },
    active: T2,
    last_paused: T1,
  })
}

function from(session: string, action: Parameters<typeof writerArgv>[1]['action'], task: string, data: Record<string, unknown> = {}) {
  return writerArgv(PYTHON, { action, task, data, session, cwd: CWD })
}

test('D64: on the terminal every session adds its own task to the footer modes', { options: OPTIONS }, async ($, on) => {
  const drawn: string[][] = []
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    drawn.push([...(e.props as { modes: string[] }).modes])
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { modes: string[] }).modes.join(' & ')}</Text>
  })
  const w = world(on, { today: day() })
  await $.session.start(START)
  for (const session of ['A', 'B', 'C', 'D']) {
    w.session = session
    await (await $.ui.mount({ ...CHIP, surface: 'terminal', props: { modes: ['focus'] } as never })).unmount()
  }
  expect(drawn).toEqual([
    ['focus', 'T1 paused'],
    ['focus', 'T2 ▶ 41m'],
    ['focus', 'T3 waiting 09:10'],
    ['focus', 'no task here'],
  ])
})

test('D64: on desktop each pane\'s chip says its task and offers the buttons that fit it', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  const seen: Record<string, { text?: string; keys: string[] }> = {}
  for (const session of ['A', 'B', 'C', 'D']) {
    w.session = session
    const ui = await $.ui.mount({ ...CHIP, surface: 'desktop', props: { modes: [] } as never })
    seen[session] = {
      text: (await ui.find({ type: 'Text' }))?.text,
      keys: (await ui.findAll({ type: 'Button' })).map(b => String(b.key)),
    }
    await ui.unmount()
  }
  expect(seen).toEqual({
    A: { text: 'T1 paused', keys: ['chip-resume', 'chip-recap'] },
    B: { text: 'T2 ▶ 41m', keys: ['chip-pause', 'chip-recap'] },
    C: { text: 'T3 waiting 09:10', keys: ['chip-recap'] },
    D: { text: 'no task here', keys: [] },
  })
})

test('D64: a click on a pane\'s chip acts on that session\'s task', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  w.session = 'B'
  const b = await $.ui.mount({ ...CHIP, surface: 'desktop', props: { modes: [] } as never })
  await b.press({ key: 'chip-pause' })
  await b.unmount()
  w.session = 'A'
  const a = await $.ui.mount({ ...CHIP, surface: 'desktop', props: { modes: [] } as never })
  await a.press({ key: 'chip-resume' })
  await a.press({ key: 'chip-recap' })
  expect(writes(w)).toEqual([from('B', 'pause', T2), from('A', 'start', T1)])
  expect(w.forks).toHaveLength(1) // the recap is this session's own, never the engine's /recap
  expect(w.ranCommands).toEqual([])
})

test('D64: the chip says when no day is open, and keeps out of the way with no data folder', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: today({ open: false, closed: true }) })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...CHIP, surface: 'desktop', props: { modes: [] } as never })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('no day open')
  await ui.unmount()
  w.today = undefined
  w.dataExists = false
  const none = await $.ui.mount({ ...CHIP, surface: 'desktop', props: { modes: [] } as never }).catch(() => undefined)
  expect(none ? await none.find({ type: 'Button' }) : undefined).toBeUndefined()
})

test('D64: /pause, /resume, /wait and /done act on this session\'s task from its own prompt', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  const run = async (session: string, command: string, args = '') => {
    w.session = session
    return (await $.command.run({ command, args } as never)).text
  }
  expect(await run('B', 'pause', 'interrupted')).toBe('Paused T2: interrupted.')
  expect(await run('B', 'pause', 'bored')).toContain('Unknown reason "bored"')
  expect(await run('A', 'pause')).toBe('T1 is paused: nothing to pause.')
  expect(await run('A', 'resume')).toBe('Resumed T1.')
  expect(await run('D', 'wait', 'T4')).toBe('T4 runs here on its own (waiting).')
  expect(await run('D', 'pause')).toContain('No task in this session')
  expect(writes(w)).toEqual([
    from('B', 'pause', T2),
    from('B', 'pause_reason', T2, { reason: 'interrupted' }),
    from('A', 'start', T1),
    from('D', 'wait', T4),
  ])
  expect(w.forks).toEqual([]) // answered without a model turn
})

test('D64: /done opens the done row for this session\'s task; /tasks opens the list', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: day() })
  await $.session.start(START)
  w.session = 'C'
  expect((await $.command.run({ command: 'done', args: '' } as never)).text).toBe('Done row for T3 is open above the prompt.')
  const band = await $.ui.mount({ plugin: 'routine', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ key: 'field-rating-0' })).toBeDefined()
  expect((await $.command.run({ command: 'tasks', args: '' } as never)).text).toBe("Today's tasks are open.")
  expect(w.opened).toEqual(['routine-tasks'])
})
