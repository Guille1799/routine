// R39 (D62): a task can wait, a pause that moves on: a session works on it alone and the
// active slot is free. The band and the pane show what waits; Wait and Start move it.
import { expect, test } from 'claude-code/testing'

import { WRITER_CALLS as C } from '../hooks/contract'
import { BAND_PROPS, OPTIONS, PANE_PROPS, START, argvOf, prompt, today, world, writes } from './world'

const TOOL = 'mcp__routine__routine'
const ACTIVE = 't-20261012-bbbbbb'
const THIRD = 't-20261012-cccccc'
const PANE = { plugin: 'routine', component: 'Pane', requestId: 'routine-tasks', props: PANE_PROPS } as const

function band(columns: number) {
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

function refusal(r: { deny?: string; isError?: boolean; text?: string }): string | undefined {
  return r.deny ?? (r.isError ? r.text : undefined)
}

/** T2 waits since 09:30; T3 is paused, so it can be set waiting too. */
function waitingT2() {
  const t = today({ active: null })
  t.tasks[ACTIVE] = { ...t.tasks[ACTIVE]!, status: 'waiting', waiting_since: '2026-10-12T09:30:00+02:00' }
  delete t.tasks[ACTIVE]!.since
  t.tasks[THIRD] = { ...t.tasks[THIRD]!, status: 'paused' }
  return t
}

test('R39: "T2 can run on its own" sets the active task waiting through the writer', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, action: 'wait' } as never)
  expect(writes(w)).toEqual([argvOf(C.wait!, ACTIVE)])
  w.today = today({ active: null })
  expect(refusal(await $.tool.call({ tool: TOOL, action: 'wait' } as never))).toContain('which task waits?')
  w.writerExit = 1
  expect(refusal(await $.tool.call({ tool: TOOL, action: 'wait', task: 'T1' } as never))).toContain('refused by the writer')
})

test('R39: the band offers Wait on the active task, and keeps it off a narrow band', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const wide = await $.ui.mount({ ...band(120), surface: 'desktop' })
  await wide.press({ key: 'wait' })
  expect(writes(w)).toEqual([argvOf(C.wait!, ACTIVE)])
  const narrow = await $.ui.mount({ ...band(56), surface: 'terminal' })
  expect(await narrow.find({ key: 'wait' })).toBeUndefined()
})

test('R39: the band says what waits and since when, shorter when narrow', { options: OPTIONS }, async ($, on) => {
  world(on, { today: waitingT2() })
  await $.session.start(START)
  expect(await text(await $.ui.mount({ ...band(120), surface: 'desktop' }))).toContain('waiting: T2 since 09:30')
  const narrow = await text(await $.ui.mount({ ...band(56), surface: 'terminal' }))
  expect(narrow).toContain('wait T2')
  expect(narrow).not.toContain('since')
})

test('R39: the pane marks the waiting task, says since when, and Start brings it back', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: waitingT2() })
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    w.runs.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    const shown = await text(ui)
    expect(shown).toContain('[w] T2 Read section 3')
    expect(shown).toContain('waiting since 09:30')
    expect(await ui.find({ key: `wait-${ACTIVE}` })).toBeUndefined() // already waiting
    expect(await ui.find({ key: `wait-${THIRD}` })).toBeDefined() // paused: can wait
    expect(await ui.find({ key: 'wait-t-20261012-aaaaaa' })).toBeUndefined() // done: cannot
    await ui.press({ key: `start-${ACTIVE}` })
    expect(writes(w)).toEqual([argvOf(C.start!, ACTIVE)])
    await ui.unmount()
  }
})

test('R39: Wait in the pane sets a paused task waiting', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: waitingT2() })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `wait-${THIRD}` })
  expect(writes(w)).toEqual([argvOf(C.wait!, THIRD)])
})

test('R39: the context lists the waiting task with its own mark', { options: OPTIONS }, async ($, on) => {
  world(on, { today: waitingT2() })
  await $.session.start(START)
  const sent = await $.prompt.submit(prompt('what is left?'))
  expect((sent.context ?? []).join('\n')).toContain('T2 [w] Read section 3')
})
