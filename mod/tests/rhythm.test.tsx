// R46 (D67, D68): the work/break rhythm is visible. The band names the technique and the
// phase with its minutes; a timed phase ends in "time for a 5-min break"; free (flowtime)
// suggests a break of about a fifth of the work; with no rhythm there is no timer.
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Today } from '../hooks/core'
import { freeBreakMinutes, parseTechnique } from '../hooks/core'
import { WRITER_CALLS as C } from '../hooks/contract'
import { BAND_PROPS, OPTIONS, START, argvOf, today, world, writes } from './world'

const ACTIVE = 't-20261012-bbbbbb'
const MIN = 60_000

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

/** T2 active since `since` (09:41 now), with this rhythm; `over` for the rest of the day. */
function at(technique: string | undefined, since = '2026-10-12T09:30:00+02:00', over: Partial<Today> = {}): Today {
  const t = today(over)
  const card = { ...t.tasks[ACTIVE]!, since }
  if (technique === undefined) delete card.technique
  else card.technique = technique
  t.tasks[ACTIVE] = card
  return t
}

/** What this session's footer chip says on desktop. */
async function chip($: Engine) {
  const ui = await $.ui.mount({ plugin: 'routine', surface: 'desktop', component: 'SessionMode', requestId: 'session-mode', props: { modes: [] } as never })
  const shown = (await ui.find({ type: 'Text' }))?.text
  await ui.unmount()
  return shown
}

describe('techniques', () => {
  test('pomodoro, 50/10 and free are read from the card; anything else is no timer', () => {
    expect(parseTechnique('pomodoro 25/5')).toEqual({ technique: 'pomodoro 25/5', name: 'Pomodoro', kind: 'timed', work: 25, rest: 5 })
    expect(parseTechnique('50/10')).toEqual({ technique: '50/10', name: '50/10', kind: 'timed', work: 50, rest: 10 })
    expect(parseTechnique('free').kind).toBe('free')
    expect(parseTechnique('none').kind).toBe('none')
    expect(parseTechnique(undefined).kind).toBe('none')
  })

  test('a free phase earns about a fifth of its work, as one of the offered lengths', () => {
    expect([10, 30, 41, 60, 120].map(freeBreakMinutes)).toEqual([5, 5, 10, 10, 20])
  })
})

test('R46: a pomodoro shows its name and the work phase with its minutes, shorter when narrow', { options: OPTIONS }, async ($, on) => {
  world(on, { today: at('pomodoro 25/5') })
  await $.session.start(START)
  expect(await text(await $.ui.mount({ ...band(140), surface: 'desktop' }))).toContain('T2 Read section 3 · Pomodoro · work 11/25')
  const narrow = await text(await $.ui.mount({ ...band(56), surface: 'terminal' }))
  expect(narrow).toContain('Pomodoro · work 11/25') // the phase is never shortened
  expect(await chip($)).toBe('T2 ▶ 11/25')
})

test('R46: at the end of the work phase the band says it is time for the break, one tap starts it', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: at('pomodoro 25/5', '2026-10-12T09:00:00+02:00') })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...band(), surface: 'desktop' })
  expect(await text(ui)).toContain('time for a 5-min break [Start break]')
  expect(await chip($)).toBe('T2 ▶ break due')
  await ui.press({ key: 'start-break' })
  expect(writes(w)).toEqual([argvOf(C.break_start!)])
})

test('R46: the end of the work phase is announced once', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: at('pomodoro 25/5', '2026-10-12T09:20:00+02:00') }) // 21 minutes in
  await $.session.start(START)
  await w.clock.advance(3 * MIN)
  expect(w.toasts).toEqual([])
  await w.clock.advance(2 * MIN) // 26 minutes in
  await w.clock.advance(5 * MIN)
  expect(w.toasts).toEqual(['Pomodoro: 25 minutes of work done. Time for a 5-min break.'])
})

test('R46: during the break the band and the chip count it down; after it the work phase starts again', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: at('pomodoro 25/5', '2026-10-12T09:00:00+02:00', { break: { technique: 'pomodoro 25/5', minutes: 5, since: '2026-10-12T09:38:00+02:00' } }) })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...band(), surface: 'desktop' })
  expect(await text(ui)).toContain('break 2/5 left')
  expect(await chip($)).toBe('T2 break 2/5')
  w.today = at('pomodoro 25/5', '2026-10-12T09:00:00+02:00', { last_break_end: '2026-10-12T09:35:00+02:00' })
  await ui.redraw()
  expect(await text(ui)).toContain('Pomodoro · work 6/25')
})

test('R46: 50/10 counts to 50 and suggests 10 minutes of break', { options: OPTIONS }, async ($, on) => {
  world(on, { today: at('50/10', '2026-10-12T09:00:00+02:00') })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect(await text(ui)).toContain('50/10 · work 41/50')
  await ui.press({ key: 'break' })
  expect((await ui.find({ key: 'break-1' }))?.props.variant).toBe('primary') // 10 min
})

test('R46: free shows the minutes worked and suggests about a fifth of them', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: at('free', '2026-10-12T09:00:00+02:00') })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...band(), surface: 'desktop' })
  expect(await text(ui)).toContain('free · 41m working')
  expect(await chip($)).toBe('T2 ▶ 41m')
  await ui.press({ key: 'break' })
  expect((await ui.find({ key: 'break-1' }))?.props.variant).toBe('primary') // 41/5 ≈ 10 min
  await ui.press({ key: 'break-1' })
  expect(writes(w)).toEqual([argvOf({ ...C.break_start!, data: { technique: 'free', minutes: 10 } })])
})

test('R46: the first start with no rhythm offers the choice in one row; no timer until a pick (D68)', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: at(undefined) })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...band(), surface: 'desktop' })
  const line = await text(ui)
  expect(line).toContain('Rhythm for T2: [pomodoro 25/5] [50/10] [free] [no timer]')
  expect(line).not.toContain('work 11')
  expect((await ui.find({ key: 'technique-0' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'technique-1' })
  expect(writes(w)).toEqual([argvOf(C.task_edit_technique!, ACTIVE)])
  w.today = at('50/10')
  await ui.redraw()
  expect(await ui.find({ key: 'technique-0' })).toBeUndefined()
})
