// R17 (the band), R25 (breaks), R26 (recap), and R30 as the band sees it.
import { expect, test } from 'claude-code/testing'

import { WRITER_CALLS as C } from '../hooks/contract'
import { BAND_PROPS, OPTIONS, START, argvOf, refreshes, today, world, writes } from './world'

const SURFACES = ['terminal', 'desktop'] as const
const BAND = { plugin: 'routine', component: 'AbovePrompt', props: BAND_PROPS } as const

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
  return parts.join(' ').replace(/\s+/g, ' ') // siblings sit a gap apart
}

test('R17: the band shows date, progress, active task with its time, buttons and the data time', { options: OPTIONS }, async ($, on) => {
  world(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const line = await text(ui)
    expect(line).toContain('2026-10-12')
    expect(line).toContain('1 of 3 done')
    expect(line).toContain('T2 Read section 3 41m')
    for (const b of ['[Pause]', '[Done]', '[Break', '[Recap]']) expect(line).toContain(b)
    expect(line).toContain('data 09:41')
    await ui.unmount()
  }
})

test('R17: the band draws on the first ask of a pane, before any surface has attached', { options: OPTIONS }, async ($, on) => {
  // The desktop asks for the band when a pane becomes the active one, and that ask is
  // what attaches its surface: the drawing must not wait for the attach-time setup.
  const w = world(on, { surfaces: [] })
  await $.session.start(START)
  expect(w.registeredTools).toEqual([])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await text(ui)).toContain('T2 Read section 3 41m')
})

test('R17: the band re-reads today.json on every draw', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  w.today = today({ active: null, last_ts: '2026-10-12T09:45:00+02:00' })
  await ui.redraw()
  const line = await text(ui)
  expect(line).toContain('no active task')
  expect(line).toContain('data 09:45')
})

test('R17: with no active task the band offers to resume the task paused last', { options: OPTIONS }, async ($, on) => {
  const SECOND = 't-20261012-bbbbbb'
  const paused = { ...today().tasks[SECOND]!, status: 'paused' as const, since: undefined }
  const w = world(on, { today: today({ active: null, last_paused: SECOND, tasks: { ...today().tasks, [SECOND]: paused } }) })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const line = await text(ui)
  expect(line).toContain('T2 Read section 3 · paused')
  expect(line).toContain('[Resume]')
  expect(line).not.toContain('[Pause]')
  await ui.press({ key: 'resume' })
  expect(writes(w)).toEqual([argvOf(C.start!, SECOND)])
})

test('R17: every load rebuilds today.json from the diary, so a copy from older code cannot outlive it', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(refreshes(w)).toHaveLength(1)
  expect(writes(w)).toEqual([]) // a rebuild writes no event
})

test('R17/R30: a missing data folder is said on the band, never thrown', { options: OPTIONS }, async ($, on) => {
  world(on, { today: undefined, dataExists: false })
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await text(ui)).toContain('no data folder: D:/routine-data')
  }
})

test('R17: a data folder with no diary yet says so', { options: OPTIONS }, async ($, on) => {
  world(on, { today: undefined })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui)).toContain('no diary yet')
})

test('R25: a break starts as a pomodoro by default, through the writer', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'break' })
  expect(await text(ui)).toContain('[5 min] [15 min] [17 min]')
  await ui.press({ key: 'break-0' })
  expect(writes(w)).toEqual([argvOf(C.break_start!)])
})

test('R25: after 25 minutes of work the band offers the break', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui)).toContain('[Break (25m up)]')
  w.today = today({ tasks: { ...today().tasks, 't-20261012-bbbbbb': { ...today().tasks['t-20261012-bbbbbb']!, since: '2026-10-12T09:30:00+02:00' } } })
  await ui.redraw()
  expect(await text(ui)).not.toContain('25m up')
})

test('R25: the time left comes from the break_start event, so a reloaded module shows the same', { options: OPTIONS }, async ($, on) => {
  // The mod keeps no timer state of its own: a fresh module (this test) reads the break from today.json.
  world(on, { today: today({ break: { technique: 'pomodoro', minutes: 5, since: '2026-10-12T09:38:00+02:00' } }) })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await text(ui)).toContain('break: 2m left')
})

test('R25: at the end of the break, one tap answers the phone question, then a recap', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: today({ break: { technique: 'pomodoro', minutes: 5, since: '2026-10-12T09:30:00+02:00' } }) })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui)).toContain('Break over. Phone during the break? [Yes] [No]')
  await ui.press({ key: 'phone-no' })
  expect(writes(w)).toEqual([argvOf(C.break_end!)])
  expect(w.forks).toHaveLength(1)
  expect(w.logs).toEqual(['Recap: drafted note'])
})

test('R26: the recap is a fork over this session, never the built-in /recap the engine refuses to a plugin', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { commands: [{ name: 'recap', source: 'builtin' }] })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'recap' })
  expect(w.ranCommands).toEqual([])
  expect(w.forks).toHaveLength(1)
  expect(w.logs).toEqual(['Recap: drafted note'])
})

test('R26: a session with nothing to recap says so', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { fork: 'nothing-to-fork' })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'recap' })
  expect(w.logs).toEqual(['Recap: nothing to recap yet in this session.'])
})
