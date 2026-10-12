// The band at the widths G works with (2-3 panes side by side): task, timer, Pause and
// Done always; the rest gives way, and stays reachable from the Tasks pane.
import { expect, test } from 'claude-code/testing'

import { BAND_MEDIUM, BAND_NARROW, BAND_WIDE, bandFit } from '../hooks/core'
import { BAND_PROPS, OPTIONS, PANE_PROPS, START, today, world } from './world'

const ACTIVE = 't-20261012-bbbbbb'
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

/** 11 minutes into the task: the break is not due yet. */
function early() {
  const t = today()
  t.tasks[ACTIVE] = { ...t.tasks[ACTIVE]!, since: '2026-10-12T09:30:00+02:00' }
  return t
}

test('R17: wide, the band shows everything, a gap apart', { options: OPTIONS }, async ($, on) => {
  world(on, { today: early() })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...band(120), surface: 'desktop' })
  const line = await text(ui)
  for (const part of ['2026-10-12', '1 of 3 done', 'T2 Read section 3', '11m', '[Pause]', '[Done]', '[Break]', '[Recap]', '[Tasks]', 'data 09:41']) {
    expect(line).toContain(part)
  }
  expect((await ui.find({ key: 'line' }))?.props.columnGap).toBe(1)
  expect((await ui.find({ type: 'Text', text: /Read section 3/ }))?.props.wrap).toBe('truncate-end')
})

test('R17: medium, the date goes and the progress and data time shorten', { options: OPTIONS }, async ($, on) => {
  world(on, { today: early() })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...band(80), surface: 'terminal' })
  const line = await text(ui)
  expect(line).not.toContain('2026-10-12')
  expect(line).not.toContain('data ')
  for (const part of ['1/3', 'T2 Read section 3', '11m', '[Pause]', '[Done]', '[Break]', '[Recap]', '[Tasks]', '09:41']) {
    expect(line).toContain(part)
  }
})

test('R17: narrow, task, timer, Pause, Done and Tasks stay; Break only once it is due', { options: OPTIONS }, async ($, on) => {
  const w = world(on, { today: early() })
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(56), surface })
    const line = await text(ui)
    for (const part of ['T2 Read section 3', '11m', '[Pause]', '[Done]', '[Tasks]', '09:41']) expect(line).toContain(part)
    for (const gone of ['1/3', '[Recap]', '[Break]']) expect(line).not.toContain(gone)
    w.today = today() // 41 minutes in: due
    await ui.redraw()
    expect((await ui.find({ key: 'break' }))?.props.variant).toBe('primary')
    w.today = early()
    await ui.unmount()
  }
})

test('R17: very narrow, the Tasks button gives way too, never the task or its buttons', { options: OPTIONS }, async ($, on) => {
  world(on, { today: early() })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...band(40), surface: 'desktop' })
  const line = await text(ui)
  for (const part of ['T2 Read section 3', '11m', '[Pause]', '[Done]']) expect(line).toContain(part)
  expect(line).not.toContain('[Tasks]')
})

test('R26/R25: Recap and Break are also in the Tasks pane, so a narrow band loses nothing', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'pane-recap' })
  expect(w.forks).toHaveLength(1)
  await pane.press({ key: 'pane-break' })
  const ui = await $.ui.mount({ ...band(56), surface: 'desktop' })
  expect(await ui.find({ key: 'break-0' })).toBeDefined()
})

test('the widths are ordered and each one keeps at least what the narrower keeps', () => {
  expect(BAND_WIDE > BAND_MEDIUM && BAND_MEDIUM > BAND_NARROW).toBe(true)
  const keeps = (c: number) => Object.values(bandFit(c)).filter(v => v !== false && v !== null).length
  expect(keeps(BAND_WIDE)).toBeGreaterThanOrEqual(keeps(BAND_MEDIUM))
  expect(keeps(BAND_MEDIUM)).toBeGreaterThanOrEqual(keeps(BAND_NARROW))
  expect(keeps(BAND_NARROW)).toBeGreaterThanOrEqual(keeps(BAND_NARROW - 1))
})
