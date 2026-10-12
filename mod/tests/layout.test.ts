// The band at the widths G works with (G, 2026-10-12: at normal width the buttons ran off the
// edge and a bare "19/25" said nothing). The line is laid out against its width: the title is
// cut first, then the other session's task, the date and the long forms, then the button
// labels shrink to their key, then the secondary buttons go. The phase in words and Tasks stay.
import { describe, expect, test } from 'claude-code/testing'

import type { BandParts } from '../hooks/core'
import { BUTTON_CHROME, buttonLabel, fitBand } from '../hooks/core'
import { BAND_PROPS, OPTIONS, PANE_PROPS, START, today, world } from './world'

const ACTIVE = 't-20261012-bbbbbb'
const PANE = { plugin: 'routine', component: 'Pane', requestId: 'routine-tasks', props: PANE_PROPS } as const
const LONG = 'Answer the five open questions about the channels that are left'

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

/** G's case: a long title, a pomodoro 11 minutes in. */
function pomodoro(title = LONG) {
  const t = today()
  t.tasks[ACTIVE] = { ...t.tasks[ACTIVE]!, title, technique: 'pomodoro 25/5', since: '2026-10-12T09:30:00+02:00' }
  return t
}

/** The width the band's line takes as drawn: texts and labels, a gap between items, the chrome of each button. */
async function drawnWidth(ui: { drawn: () => Promise<unknown> }): Promise<number> {
  const line = ((await ui.drawn()) as { children: { props?: { key?: string }; children: unknown[] }[] }).children[0]!
  return line.children.reduce((w: number, c: unknown, n: number) => {
    const el = c as { type: string; props?: { label?: string }; children?: unknown[] }
    const own = el.type === 'Button' ? (el.props?.label?.length ?? 0) + BUTTON_CHROME : (el.children ?? []).join('').length
    return w + own + (n > 0 ? 1 : 0)
  }, 0)
}

for (const [name, columns] of [['wide', 140], ['normal', 100], ['half', 70], ['third', 60]] as const) {
  test(`R17/R46: ${name} (${columns} columns): the line fits, the phase reads in words, Tasks stays`, { options: OPTIONS }, async ($, on) => {
    world(on, { today: pomodoro() })
    await $.session.start(START)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...band(columns), surface })
      const line = await text(ui)
      expect(line).toContain('Pomodoro · work 11/25')
      expect(await ui.find({ key: 'tasks' })).toBeDefined()
      expect((await ui.find({ key: 'tasks' }))?.props.label).toBe('Tasks')
      expect(await ui.find({ key: 'pause' })).toBeDefined()
      expect(await ui.find({ key: 'done' })).toBeDefined()
      expect(line).toMatch(/T2 An/)
      expect(await drawnWidth(ui)).toBeLessThanOrEqual(columns)
      await ui.unmount()
    }
  })
}

test('R17: the title is cut first, with an ellipsis, before any button shrinks', { options: OPTIONS }, async ($, on) => {
  world(on, { today: pomodoro() })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...band(140), surface: 'desktop' })
  const line = await text(ui)
  expect(line).toContain('… · Pomodoro · work 11/25 [Pause] [Done]')
  expect(line).not.toContain(LONG)
})

test('R17: a short title is kept whole while there is room', { options: OPTIONS }, async ($, on) => {
  world(on, { today: pomodoro('Read section 3') })
  await $.session.start(START)
  expect(await text(await $.ui.mount({ ...band(140), surface: 'desktop' }))).toContain('2026-10-12 1 of 3 done · T2 Read section 3 · Pomodoro · work 11/25 [Pause] [Done] [Wait] [Break] [Recap] [Tasks] data 09:41')
})

test('R17: narrow, the button labels shrink to their key, and Tasks keeps its name', { options: OPTIONS }, async ($, on) => {
  world(on, { today: pomodoro() })
  await $.session.start(START)
  const line = await text(await $.ui.mount({ ...band(70), surface: 'terminal' }))
  expect(line).toContain('[P] [D]')
  expect(line).toContain('[Tasks]')
  expect(line).not.toContain('[Pause]')
})

test('R26/R25: Recap and Break are also in the Tasks pane, so a narrow band loses nothing', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'pane-recap' })
  expect(w.forks).toHaveLength(1)
  await pane.press({ key: 'pane-break' })
  const ui = await $.ui.mount({ ...band(48), surface: 'desktop' })
  expect(await ui.find({ key: 'break-0' })).toBeDefined()
})

describe('fitBand', () => {
  const parts: BandParts = {
    date: '2026-10-12', progress: '2 of 13 done', progressShort: '2/13',
    title: `T3 ${LONG}`, phase: 'Pomodoro · work 19/25',
    buttons: [
      { key: 'pause', label: 'Pause', hotkey: 'p' }, { key: 'done', label: 'Done', hotkey: 'd' },
      { key: 'wait', label: 'Wait', hotkey: 'w', secondary: true }, { key: 'break', label: 'Break', hotkey: 'b', secondary: true },
      { key: 'recap', label: 'Recap', hotkey: 'r', secondary: true }, { key: 'tasks', label: 'Tasks', hotkey: 't', keep: true },
    ],
    asOf: 'data 09:41', asOfShort: '09:41',
  }

  // Below about 58 columns G's long case cannot fit without dropping the phase, which never goes.
  test('at every width from 60 to 200 the estimate fits, the phase is whole and Tasks stays', () => {
    for (let columns = 60; columns <= 200; columns += 1) {
      const lay = fitBand(columns, parts)
      expect(lay.width).toBeLessThanOrEqual(columns)
      expect(lay.dropped).not.toContain('tasks')
      expect(lay.dropped).not.toContain('pause')
      expect(lay.dropped).not.toContain('done')
      expect(buttonLabel(parts.buttons[5]!, lay.compact)).toBe('Tasks')
    }
  })

  test('the more room, the more is kept', () => {
    const kept = (c: number) => {
      const lay = fitBand(c, parts)
      const progress = lay.progress === 'long' ? 2 : lay.progress === 'short' ? 1 : 0
      return (lay.date ? 1 : 0) + progress + (lay.compact ? 0 : 1) + (lay.extra ? 1 : 0) + (lay.asOf === 'long' ? 1 : 0) - lay.dropped.length
    }
    for (let columns = 61; columns <= 200; columns += 1) expect(kept(columns)).toBeGreaterThanOrEqual(kept(columns - 1))
  })
})
