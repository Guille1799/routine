// R15 (context, never in -p), R16 (start/pause from chat), R20 (inbox), R27 (usage).
import { expect, test } from 'claude-code/testing'

import { WRITER_CALLS as C } from '../hooks/contract'
import { CWD, OPTIONS, START, argvOf, prompt, today, world, writes } from './world'

const TOOL = 'mcp__routine__routine'

/** The model's error text when the tool refused, else undefined. */
function refusal(r: { deny?: string; isError?: boolean; text?: string }): string | undefined {
  return r.deny ?? (r.isError ? r.text : undefined)
}
const ACTIVE = 't-20261012-bbbbbb'
const THIRD = 't-20261012-cccccc'

test('R15: an interactive session carries the active task, its perimeter and the drift rule', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const sent = await $.prompt.submit(prompt('what does "ablation" mean here?'))
  const context = (sent.context ?? []).join('\n')
  expect(context).toContain('Active task T2: Read section 3')
  expect(context).toContain('Perimeter (what counts as related): questions about the text, unknown terms')
  expect(context).toContain('Last note: read 3.1; next 3.2')
  expect(context).toContain('drift_warn')
  expect(context).toContain('Warn only once')
  expect(sent.text).toBe('what does "ablation" mean here?')
  expect(writes(w)).toEqual([])
})

test('R15: the context is read at send time, never cached', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.prompt.submit(prompt('one'))
  w.today = today({ active: THIRD })
  const sent = await $.prompt.submit(prompt('two'))
  expect((sent.context ?? []).join('\n')).toContain('Active task T3: Fix the parser')
})

test('R15: a non-interactive run (claude -p) gets no tool, no command, no context and writes nothing', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { surfaces: [] })
  await $.session.start(START)
  const sent = await $.prompt.submit(prompt('/inbox should not be captured here'))
  expect(sent.context).toBeUndefined()
  await $.turn.complete({
    answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' },
  } as never)
  expect(w.registeredTools).toEqual([])
  expect(w.registeredCommands).toEqual([])
  expect(w.runs).toEqual([])
})

test('R15: a desktop session that attaches after start gets the tool then', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { surfaces: [] })
  await $.session.start(START)
  expect(w.registeredTools).toEqual([])
  w.surfaces = ['desktop']
  await $.session.attach({ clientId: 'c1', surface: 'desktop' } as never)
  expect(w.registeredTools).toEqual(['routine'])
  expect(w.registeredCommands).toEqual(['inbox'])
})

test('R16: "let\'s do T3" starts the stable id through the writer and hands back the card', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const r = await $.tool.call({ tool: TOOL, action: 'start', task: 'T3' } as never)
  expect(writes(w)).toEqual([argvOf(C.start!, THIRD)])
  expect(String(r.text ?? (r as { result?: unknown }).result)).toContain('Perimeter: the parser and its tests')
  expect(writes(w)[0]).toContain(CWD)
})

test('R16: pause needs a note and reaches the writer with it', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const refused = await $.tool.call({ tool: TOOL, action: 'pause' } as never)
  expect(refusal(refused)).toContain('a pause needs a note')
  expect(writes(w)).toEqual([])
  await $.tool.call({ tool: TOOL, action: 'pause', note: C.pause!.data!.note } as never)
  expect(writes(w)).toEqual([argvOf(C.pause!, ACTIVE)])
})

test('R16: an unknown task is asked back, never guessed', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const r = await $.tool.call({ tool: TOOL, action: 'start', task: 'T9' } as never)
  expect(refusal(r)).toContain('T1 [x] Answer two mails')
  expect(writes(w)).toEqual([])
})

test('R16: a refusal of the writer reaches the model as an error', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { writerExit: 1 })
  await $.session.start(START)
  const r = await $.tool.call({ tool: TOOL, action: 'start', task: 'T3' } as never)
  expect(refusal(r)).toContain('refused by the writer')
  expect(writes(w)).toHaveLength(1)
})

test('R20: /inbox <text> is captured without a model turn', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const sent = await $.prompt.submit(prompt('/inbox buy milk'))
  expect(sent.drop).toBe('Captured to the inbox.')
  expect(writes(w)).toEqual([argvOf(C.inbox!)])
})

test('R20: the /inbox command captures too, and an empty one writes nothing', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ran = await $.command.run({ command: 'inbox', args: ' buy milk ' })
  expect(ran.text).toBe('Captured to the inbox.')
  const empty = await $.command.run({ command: 'inbox', args: '' })
  expect(empty.text).toContain('Nothing to capture')
  expect(writes(w)).toEqual([argvOf(C.inbox!)])
})

test('R16: things the user said are kept through the writer', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL, action: 'said', ...C.said!.data } as never)
  await $.tool.call({ tool: TOOL, action: 'inbox', text: 'buy milk' } as never)
  expect(writes(w)).toEqual([argvOf(C.said!), argvOf(C.inbox!)])
})

const USAGE = { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, model: 'claude-test' }

test('R27: each turn with an active task logs its token usage against that task', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE } as never)
  expect(writes(w)).toEqual([argvOf(C.usage!, ACTIVE)])
})

test('R27: no active task, no usage event', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: today({ active: null }) })
  await $.session.start(START)
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE } as never)
  expect(writes(w)).toEqual([])
})
