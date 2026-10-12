// R38 (D59): the active task pauses itself after N idle minutes, counted from the end of
// the session's last answer, with the reason `idle`. N comes from the user's config.
import { expect, test } from 'claude-code/testing'

import { WRITER_CALLS as C } from '../hooks/contract'
import { OPTIONS, START, argvOf, prompt, today, world, writes } from './world'

const ACTIVE = 't-20261012-bbbbbb'
const MIN = 60_000
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }

type Engine = { turn: { complete: (e: never) => Promise<unknown> } }

/** The end of one of the session's answers. */
function answered($: Engine, agentId?: string) {
  return $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't', reason: 'answer', usage: USAGE, ...(agentId ? { agentId } : {}) } as never)
}

/** The idle pauses written so far (the usage events of each answer left out). */
function idlePauses(w: ReturnType<typeof world>): string[][] {
  return writes(w).filter(a => a[3] === 'pause')
}

test('R38: 20 idle minutes after the last answer, the active task pauses with the reason idle', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await answered($)
  await w.clock.advance(19 * MIN)
  expect(idlePauses(w)).toEqual([])
  await w.clock.advance(1 * MIN)
  expect(idlePauses(w)).toEqual([argvOf(C.pause_idle!, ACTIVE)])
  expect(w.toasts).toEqual(['Paused after 20 idle minutes. Resume when you are back.'])
})

test('R38: what the user types stops the count until the next answer ends', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await answered($)
  await w.clock.advance(10 * MIN)
  await $.prompt.submit(prompt('a long question'))
  await w.clock.advance(30 * MIN)
  expect(idlePauses(w)).toEqual([])
  await answered($)
  await w.clock.advance(20 * MIN)
  expect(idlePauses(w)).toHaveLength(1)
})

test('R38: activity in another session, seen in the diary, moves the count on', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await answered($)
  await w.clock.advance(15 * MIN)
  w.today = today({ last_ts: '2026-10-12T09:56:00+02:00' }) // another session wrote at +15
  await w.clock.advance(5 * MIN)
  expect(idlePauses(w)).toEqual([])
  await w.clock.advance(15 * MIN)
  expect(idlePauses(w)).toEqual([argvOf(C.pause_idle!, ACTIVE)])
})

test('R38: N comes from the config; 0 turns it off, and an unreadable config never pauses', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { settings: { idle_pause_minutes: 5 } })
  await $.session.start(START)
  await answered($)
  await w.clock.advance(5 * MIN)
  expect(idlePauses(w)).toHaveLength(1)
  w.runs.length = 0
  w.settings = { idle_pause_minutes: 0 }
  await answered($)
  await w.clock.advance(120 * MIN)
  w.settings = { exit: 1, error: 'routine.toml: idle_pause_minutes must be a whole number' }
  await answered($)
  await w.clock.advance(120 * MIN)
  expect(idlePauses(w)).toEqual([])
})

/** T2 waits (D62): a session works on it alone, so the active slot is free. */
function waitingT2(active: string | null) {
  const t = today({ active })
  t.tasks[ACTIVE] = { ...t.tasks[ACTIVE]!, status: 'waiting', waiting_since: '2026-10-12T09:30:00+02:00' }
  delete t.tasks[ACTIVE]!.since
  if (active) t.tasks[active] = { ...t.tasks[active]!, status: 'active', since: '2026-10-12T09:35:00+02:00' }
  return t
}

const QUIET = {
  'a waiting task': waitingT2(null),
  'a break': today({ break: { technique: 'pomodoro', minutes: 5, since: '2026-10-12T09:41:00+02:00' } }),
  'no active task': today({ active: null }),
}
for (const [name, state] of Object.entries(QUIET)) {
  test(`R38: ${name} is never paused for idleness`, { options: OPTIONS }, async ($, on) => {
    const w = world(on, { today: state })
    await $.session.start(START)
    await answered($)
    await w.clock.advance(60 * MIN)
    expect(idlePauses(w)).toEqual([])
  })
}

test('R38: with T2 waiting and T3 active, the idle pause stops T3 and leaves T2 waiting', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: waitingT2('t-20261012-cccccc') })
  await $.session.start(START)
  await answered($)
  await w.clock.advance(20 * MIN)
  expect(idlePauses(w)).toEqual([argvOf(C.pause_idle!, 't-20261012-cccccc')])
})

test('R38: a subagent finishing is not the session answering', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await w.clock.advance(15 * MIN) // the main answer ended at the load (the diary's last event)
  await answered($, 'agent-1')
  await w.clock.advance(5 * MIN)
  expect(idlePauses(w)).toHaveLength(1)
})

test('R38: after a load, idleness counts from the diary\'s last event', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: today({ last_ts: '2026-10-12T09:11:00+02:00' }) }) // 30 minutes ago
  await $.session.start(START)
  expect(idlePauses(w)).toEqual([argvOf(C.pause_idle!, ACTIVE)])
})

test('R38: a non-interactive run never pauses anything', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { surfaces: [] })
  await $.session.start(START)
  await answered($)
  await w.clock.advance(60 * MIN)
  expect(w.runs).toEqual([])
})
