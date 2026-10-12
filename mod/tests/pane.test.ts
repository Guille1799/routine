// R17, expanded: the band's Tasks button opens a pane with today's full list.
import { expect, test } from 'claude-code/testing'

import { WRITER_CALLS as C } from '../hooks/contract'
import { BAND_PROPS, OPTIONS, PANE_PROPS, START, argvOf, today, world, writes } from './world'

const BAND = { plugin: 'routine', component: 'AbovePrompt', props: BAND_PROPS } as const
const PANE = { plugin: 'routine', component: 'Pane', requestId: 'routine-tasks', props: PANE_PROPS } as const
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const THIRD = 't-20261012-cccccc'

async function text(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  const parts: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === 'string') parts.push(n)
    else if (n && typeof n === 'object') {
      const o = n as { children?: unknown[]; props?: { label?: string } }
      if (o.props?.label) parts.push(`[${o.props.label}]`)
      for (const c of o.children ?? []) walk(c)
      parts.push('\n')
    }
  }
  walk(await ui.drawn())
  return parts.join('').replace(/\n+/g, '\n')
}

function withPausedAndCarried() {
  const t = today({ inbox: { 'i-1': { text: 'buy milk', since: '2026-10-12T08:00:00+02:00' }, 'i-2': { text: 'call back', since: '2026-10-12T08:10:00+02:00' } } })
  t.tasks[THIRD] = { ...t.tasks[THIRD]!, status: 'paused', carried: 2 }
  return t
}

test('R17: the Tasks button opens the pane, and the band stays one line', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const tree = (await band.drawn()) as { children?: unknown[] }
  expect(tree.children).toHaveLength(1)
  await band.press({ key: 'tasks' })
  expect(w.opened).toEqual(['routine-tasks'])
})

test('R17: the pane lists every task with its mark, card, carried counter and the inbox count', { options: OPTIONS }, async ($, on) => {
  world(on, { today: withPausedAndCarried() })
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const shown = await text(ui)
    expect(shown).toContain('1 of 3 done · inbox 2 · data 09:41')
    expect(shown).toContain('[x] T1 Answer two mails')
    expect(shown).toContain('[>] T2 Read section 3 \n[Done]')
    expect(shown).toContain('done when: notes written')
    expect(shown).toContain('first step: open the pdf')
    expect(shown).toContain('[~] T3 Fix the parser · carried 2x \n[Start]')
    expect(await ui.find({ key: 'start-t-20261012-aaaaaa' })).toBeUndefined() // a done task offers nothing
    expect(await ui.find({ key: 'done-t-20261012-cccccc' })).toBeUndefined()
    await ui.unmount()
  }
})

test('R16: Start in the pane starts that task through the writer', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: withPausedAndCarried() })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `start-${THIRD}` })
  expect(writes(w)).toEqual([argvOf(C.start!, THIRD)])
})

test('R16: a start the writer refuses is said, not swallowed', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { writerExit: 1 })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `start-${THIRD}` })
  expect(w.toasts).toEqual(['Start: refused by the writer'])
})

test('R19: Done in the pane opens the same one-step done row', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'done-t-20261012-bbbbbb' })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'field-rating-0' })).toBeDefined()
  expect(writes(w)).toEqual([])
})

test('R17: the pane says when there is no data folder', { options: OPTIONS }, async ($, on) => {
  world(on, { today: undefined, dataExists: false })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await text(ui)).toContain('no data folder: D:/routine-data')
})

const FIRST = 't-20261012-aaaaaa'

test('D57: a finished task offers Reopen, which asks the reason before writing', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    w.runs.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: `reopen-why-${FIRST}` })).toBeUndefined()
    await ui.press({ key: `reopen-${FIRST}` })
    await ui.input({ key: `reopen-why-${FIRST}`, text: '  ' })
    expect(await text(ui)).toContain('Say why first.')
    expect(writes(w)).toEqual([])
    await ui.input({ key: `reopen-why-${FIRST}`, text: C.reopen!.data!.why as string })
    expect(writes(w)).toEqual([argvOf(C.reopen!, FIRST)])
    expect(await ui.find({ key: `reopen-why-${FIRST}` })).toBeUndefined()
    await ui.unmount()
  }
})

test('D57: a reopen the writer refuses is said in the pane', { options: OPTIONS }, async ($, on) => {
  world(on, { writerExit: 1 })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `reopen-${FIRST}` })
  await ui.input({ key: `reopen-why-${FIRST}`, text: 'x' })
  expect(await text(ui)).toContain('refused by the writer')
})

test('D57: the phone has no text field, so it offers no Reopen', { options: OPTIONS }, async ($, on) => {
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ key: `reopen-${FIRST}` })).toBeUndefined()
})
