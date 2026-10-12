// R37 (D61): a task card can be edited from chat and from the Tasks pane; the writer
// decides which fields are editable and refuses an emptied start field.
import { expect, test } from 'claude-code/testing'

import { WRITER_CALLS as C } from '../hooks/contract'
import { OPTIONS, PANE_PROPS, START, argvOf, today, world, writes } from './world'

const TOOL = 'mcp__routine__routine'
const ACTIVE = 't-20261012-bbbbbb'
const THIRD = 't-20261012-cccccc'
const PANE = { plugin: 'routine', component: 'Pane', requestId: 'routine-tasks', props: PANE_PROPS } as const

function refusal(r: { deny?: string; isError?: boolean; text?: string }): string | undefined {
  return r.deny ?? (r.isError ? r.text : undefined)
}

function withPriority() {
  const t = today()
  t.tasks[ACTIVE] = { ...t.tasks[ACTIVE]!, priority: true }
  return t
}

test('R37: edit from chat sends the changes for the task named, and asks when nothing is said', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(refusal(await $.tool.call({ tool: TOOL, action: 'edit', task: 'T3' } as never))).toContain('edit needs changes')
  expect(refusal(await $.tool.call({ tool: TOOL, action: 'edit', task: 'T9', changes: { title: 'x' } } as never))).toContain('which task?')
  expect(writes(w)).toEqual([])
  await $.tool.call({ tool: TOOL, action: 'edit', task: 'T3', changes: C.task_edit!.data!.changes } as never)
  expect(writes(w)).toEqual([argvOf(C.task_edit!, THIRD)])
})

test('R37: Edit in the pane shows the card, and Save sends only what changed', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    w.runs.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: `edit-${THIRD}` })
    expect((await ui.find({ key: `edit-title-${THIRD}` }))?.props.value).toBe('Fix the parser')
    expect((await ui.find({ key: `edit-perimeter-${THIRD}` }))?.props.value).toBe('the parser and its tests')
    await ui.input({ key: `edit-first_step-${THIRD}`, text: 'open the pdf at 3.3', kind: 'change' })
    await ui.press({ key: `edit-save-${THIRD}` })
    expect(writes(w)).toEqual([argvOf(C.task_edit!, THIRD)])
    expect(await ui.find({ key: `edit-title-${THIRD}` })).toBeUndefined()
    await ui.unmount()
  }
})

test('R37: saving an unchanged card writes nothing and closes the edit', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `edit-${THIRD}` })
  await ui.input({ key: `edit-title-${THIRD}`, text: '  Fix the parser ', kind: 'change' })
  await ui.press({ key: `edit-save-${THIRD}` })
  expect(writes(w)).toEqual([])
  expect(await ui.find({ key: `edit-title-${THIRD}` })).toBeUndefined()
})

test('R37: an emptied start field reaches the writer, and its refusal is said in place', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `edit-${THIRD}` })
  await ui.input({ key: `edit-perimeter-${THIRD}`, text: '', kind: 'change' })
  w.writerExit = 1
  await ui.press({ key: `edit-save-${THIRD}` })
  const sent = writes(w).at(-1) ?? []
  expect(JSON.parse(sent[sent.indexOf('--data') + 1]!)).toEqual({ changes: { perimeter: '' } })
  expect(JSON.stringify(await ui.drawn())).toContain('refused by the writer')
  expect(await ui.find({ key: `edit-perimeter-${THIRD}` })).toBeDefined()
})

test('R37: the priority shows, and Unset priority clears it, on every surface', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: withPriority() })
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    w.runs.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /T2 ★ Read section 3/ })).toBeDefined()
    expect(await ui.find({ key: `unprioritize-${THIRD}` })).toBeUndefined()
    await ui.press({ key: `unprioritize-${ACTIVE}` })
    const sent = writes(w).at(-1) ?? []
    expect(sent.slice(3, 5)).toEqual(['task-edit', '--task'])
    expect(JSON.parse(sent[sent.indexOf('--data') + 1]!)).toEqual({ changes: { priority: false } })
    await ui.unmount()
  }
})

test('R37: the phone has no text field, so it offers no Edit', { options: OPTIONS }, async ($, on) => {
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ key: `edit-${THIRD}` })).toBeUndefined()
})
