// Ask to start the day (G, 2026-10-12: "always, from now on"): once per session per day.
import { expect, test } from 'claude-code/testing'

import { BAND_PROPS, NOW, OPTIONS, START, prompt, today, world, writes } from './world'

const BAND = { plugin: 'routine', component: 'AbovePrompt', props: BAND_PROPS } as const
const ASK = 'whether to start the day with /plan-day'

type Submit = { prompt: { submit: (e: never) => Promise<{ context?: readonly string[] }> } }

async function context($: Submit, text = 'hello'): Promise<string> {
  return ((await $.prompt.submit(prompt(text))).context ?? []).join('\n')
}

async function bandText(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  const parts: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === 'string') parts.push(n)
    else if (n && typeof n === 'object') for (const c of (n as { children?: unknown[] }).children ?? []) walk(c)
  }
  walk(await ui.drawn())
  return parts.join(' ').replace(/\s+/g, ' ') // siblings sit a gap apart
}

test('R36: with no diary the session asks once, and the band points to /plan-day', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: undefined })
  await $.session.start(START)
  const first = await context($)
  expect(first).toContain('No day is open for today (2026-10-12)')
  expect(first).toContain(ASK)
  expect(await context($, 'and another thing')).not.toContain(ASK)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await bandText(ui)).toContain('no diary yet · /plan-day')
  expect(writes(w)).toEqual([])
})

test('R36: yesterday closed, today not opened: ask once; the band says so', { options: OPTIONS }, async ($, on) => {
  world(on, { today: today({ day: '2026-10-11', open: false, closed: true, active: null }) })
  await $.session.start(START)
  expect(await context($)).toContain(ASK)
  expect(await context($)).not.toContain(ASK)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await bandText(ui)).toContain('2026-10-12 · no day open today · /plan-day')
})

test('R36: yesterday still open: /plan-day closes it first, and the task context stays', { options: OPTIONS }, async ($, on) => {
  world(on, { today: today({ day: '2026-10-11' }) })
  await $.session.start(START)
  const first = await context($)
  expect(first).toContain(ASK)
  expect(first).toContain('Day 2026-10-11 is still open: /plan-day closes it first.')
  expect(first).toContain('Active task T2: Read section 3')
  const second = await context($)
  expect(second).not.toContain(ASK)
  expect(second).toContain('Active task T2: Read section 3')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await bandText(ui)).toContain('2026-10-11 still open · /plan-day 2026-10-11')
})

test('R36: a day open for today asks nothing', { options: OPTIONS }, async ($, on) => {
  world(on)
  await $.session.start(START)
  expect(await context($)).not.toContain('/plan-day')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await bandText(ui)).not.toContain('/plan-day')
})

test('R36: the next day, the same session asks again, once', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: today({ day: '2026-10-11', open: false, closed: true, active: null }) })
  await $.session.start(START)
  expect(await context($)).toContain(ASK)
  expect(await context($)).not.toContain(ASK)
  await w.clock.set(NOW + 24 * 3600_000)
  w.today = today({ day: '2026-10-12', open: false, closed: true, active: null })
  expect(await context($)).toContain('No day is open for today (2026-10-13)')
  expect(await context($)).not.toContain(ASK)
})

test('R36: a non-interactive run (claude -p) is never asked', { options: OPTIONS }, async ($, on) => {
  world(on, { today: undefined, surfaces: [] })
  await $.session.start(START)
  expect(await context($)).toBe('')
})

test('R36: a missing data folder is not a day to plan: nothing is asked', { options: OPTIONS }, async ($, on) => {
  world(on, { today: undefined, dataExists: false })
  await $.session.start(START)
  expect(await context($)).not.toContain(ASK)
})
