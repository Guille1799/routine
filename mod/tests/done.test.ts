// R19 (done in one step, missing fields asked), R32 (fields from the config), R18 (drift warned once),
// R34 (pause at the click, its reason, leaving with the context).
import { expect, test } from 'claude-code/testing'

import { WRITER_CALLS as C } from '../hooks/contract'
import { BAND_PROPS, OPTIONS, START, argvOf, prompt, today, world, writes } from './world'

const TOOL = 'mcp__routine__routine'
const ACTIVE = 't-20261012-bbbbbb'
const BAND = { plugin: 'routine', component: 'AbovePrompt', props: BAND_PROPS } as const
const DONE = C.done!.data as { fields: Record<string, unknown>; note: string }

/** today.json after the writer folded a pause of the active task (the fake writer folds nothing). */
function pausedToday(reason: string | null) {
  const t = today({ active: null, last_paused: ACTIVE })
  t.tasks[ACTIVE] = { ...t.tasks[ACTIVE]!, status: 'paused', since: undefined, pauses: [{ at: '2026-10-12T09:41:00+02:00', reason }] }
  return t
}

function refusal(r: { deny?: string; isError?: boolean; text?: string }): string | undefined {
  return r.deny ?? (r.isError ? r.text : undefined)
}

test('R19: done from chat with every field writes one done event with the fields and the note', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const { note, ...fields } = DONE.fields
  await $.tool.call({ tool: TOOL, action: 'done', fields, note } as never)
  expect(writes(w)).toEqual([argvOf(C.done!, ACTIVE)])
})

test('R19: missing required fields are asked, and nothing is written', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const r = await $.tool.call({ tool: TOOL, action: 'done', fields: { learned_how: 'video' }, note: 'x' } as never)
  const asked = refusal(r) ?? ''
  expect(asked).toContain('rating (How was it?): one of 🔥 / 😐 / 🥱')
  expect(asked).toContain('drifted (Did you drift?): yes or no')
  expect(asked).not.toContain('phone')
  expect(writes(w)).toEqual([])
})

test('R19: done from the band is one step: one row per field, the drafted note, one save', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    w.runs.length = 0
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'done' })
    expect(w.forks).toHaveLength(surface === 'terminal' ? 1 : 2) // the session drafts the note
    const note = await ui.find({ key: 'field-note' })
    expect(note?.props.value).toBe('drafted note')
    await ui.press({ key: 'save' })
    expect(JSON.stringify(await ui.drawn())).toContain('Missing: How was it?, Did you drift?')
    expect(writes(w)).toEqual([])
    await ui.press({ key: 'field-rating-0' })
    await ui.press({ key: 'field-learned_how-0' })
    await ui.press({ key: 'field-drifted-1' })
    await ui.press({ key: 'field-phone-1' })
    await ui.input({ key: 'field-note', text: DONE.note })
    await ui.press({ key: 'save' })
    expect(writes(w)).toEqual([argvOf(C.done!, ACTIVE)])
    expect(await ui.find({ key: 'save' })).toBeUndefined()
    await ui.unmount()
  }
})

test('R32: the done row follows the config file, not the code', { options: OPTIONS }, async ($, on) => {
  const w = world(on, {
    fields: [{ id: 'energy', label: 'Energy left?', kind: 'buttons', options: ['high', 'low'], required: true }],
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'done' })
  expect(await ui.find({ key: 'field-energy-1' })).toBeDefined()
  expect(await ui.find({ key: 'field-rating-0' })).toBeUndefined()
  expect(await ui.find({ key: 'field-note' })).toBeUndefined()
  expect(w.forks).toEqual([]) // no text field asks for a draft, so none is made
  const r = await $.tool.call({ tool: TOOL, action: 'done', fields: { rating: '🔥' } } as never)
  expect(refusal(r)).toContain('energy (Energy left?): one of high / low')
  await $.tool.call({ tool: TOOL, action: 'done', fields: { energy: 'low', rating: '🔥' } } as never)
  const written = writes(w).at(-1) ?? []
  expect(JSON.parse(written[written.indexOf('--data') + 1]!)).toEqual({ fields: { energy: 'low' } })
})

test('R32: an unreadable config is said, and nothing is written', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { fields: { exit: 1, error: 'done_fields.toml: invalid TOML at line 3' } })
  await $.session.start(START)
  const r = await $.tool.call({ tool: TOOL, action: 'done', fields: {}, note: 'x' } as never)
  expect(refusal(r)).toContain('invalid TOML at line 3')
  expect(writes(w)).toEqual([])
})

test('R34: Pause stops the task at the click, before any reason or context', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'pause' })
  expect(writes(w)).toEqual([argvOf(C.pause_click!, ACTIVE)])
  expect(w.forks).toHaveLength(1) // the context to leave is drafted after the pause, not before
})

test('R34: the reason is written at each pick while the pause lasts, and the band shows the one kept', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'pause' })
  w.today = pausedToday(null)
  await ui.redraw()
  await ui.press({ key: 'field-reason-1' })
  expect(writes(w).at(-1)).toEqual(argvOf(C.pause_reason!, ACTIVE))
  w.today = pausedToday('interrupted')
  await ui.redraw()
  expect((await ui.find({ key: 'field-reason-1' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'resume' })
  w.today = today()
  await ui.redraw()
  expect(await ui.find({ key: 'field-reason-1' })).toBeUndefined() // after Resume the reason stays as it was
})

test('R34: leaving saves the drafted context the user corrected, as its own step', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'pause' })
  w.today = pausedToday(null)
  await ui.redraw()
  expect((await ui.find({ key: 'save' }))?.props.label).toBe('Leave · save context')
  expect((await ui.find({ key: 'field-note' }))?.props.value).toBe('drafted note')
  await ui.input({ key: 'field-note', text: C.checkpoint!.data!.note as string })
  await ui.press({ key: 'save' })
  expect(writes(w)).toEqual([argvOf(C.pause_click!, ACTIVE), argvOf(C.checkpoint!, ACTIVE)])
  expect(await ui.find({ key: 'field-note' })).toBeUndefined()
})

test('R18: the drift warning and the reply reach the writer, and the writer refusal reaches the model', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, action: 'drift_warn', ...C.drift_warn!.data } as never)
  await $.tool.call({ tool: TOOL, action: 'drift_reply', reply: 'continue', why: 'it is related after all' } as never)
  expect(writes(w)).toEqual([argvOf(C.drift_warn!, ACTIVE), argvOf(C.drift_reply!, ACTIVE)])
  w.writerExit = 1 // the writer refuses a second warning (D54); the mod does not judge it
  const again = await $.tool.call({ tool: TOOL, action: 'drift_warn', message: 'something else' } as never)
  expect(refusal(again)).toContain('refused by the writer')
})

test('R18: the context tells the model where the drift episode stands', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const context = async () => ((await $.prompt.submit(prompt('and another thing'))).context ?? []).join('\n')
  expect(await context()).toContain('Warn once per drift')
  w.today = today({ drift: { [ACTIVE]: { warned: 1, replies: [], open: true } } })
  expect(await context()).toContain('a warning is open')
  w.today = today({ drift: { [ACTIVE]: { warned: 1, replies: [{ action: 'continue', why: 'x' }], open: false } } })
  expect(await context()).toContain('already justified staying on this. Do not warn again.')
  w.today = today({ drift: { [ACTIVE]: { warned: 1, replies: [{ action: 'back' }], open: false } } })
  expect(await context()).toContain('Warn once per drift')
})
