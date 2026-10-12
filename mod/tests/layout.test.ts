// The band in two rows (G, 2026-10-12): row 1 says where this session is (progress, the task,
// the phase in words, the other session's task), row 2 holds every button with its key and
// the data time. Each row fits its width on its own: in row 1 the other session's task goes
// first, then the date, then the title is cut; in row 2 the labels shrink to their key and the
// secondary buttons go only in very narrow panes. The phase and Tasks always stay.
import { describe, expect, test } from 'claude-code/testing'

import type { BandParts } from '../hooks/core'
import { BUTTON_CHROME, buttonLabel, fitRows } from '../hooks/core'
import { BAND_PROPS, OPTIONS, PANE_PROPS, START, today, world } from './world'

const ACTIVE = 't-20261012-bbbbbb'
const PANE = { plugin: 'routine', component: 'Pane', requestId: 'routine-tasks', props: PANE_PROPS } as const
const LONG = 'Answer the five open questions about the channels that are left'

function band(columns: number) {
  return { plugin: 'routine', component: 'AbovePrompt', props: { ...(BAND_PROPS as object), bodyColumns: columns } as never } as const
}

type Node = { type: string; props?: { key?: string; label?: string }; children?: unknown[] }

function textOf(n: unknown): string {
  if (typeof n === 'string') return n
  const o = n as Node
  return [o.props?.label ? `[${o.props.label}]` : '', ...(o.children ?? []).map(textOf)].filter(Boolean).join(' ')
}

/** The band's rows as drawn: each row's text, and its width as the estimate counts it. */
async function rows(ui: { drawn: () => Promise<unknown> }): Promise<{ text: string; width: number }[]> {
  const root = (await ui.drawn()) as Node
  return (root.children as Node[]).map(row => ({
    text: textOf(row).replace(/\s+/g, ' '),
    width: (row.children ?? []).reduce((w: number, c: unknown, n: number) => {
      const el = c as Node
      const own = el.type === 'Button' ? (el.props?.label?.length ?? 0) + BUTTON_CHROME : (el.children ?? []).join('').length
      return w + own + (n > 0 ? 1 : 0)
    }, 0),
  }))
}

/** G's case: a long title, a pomodoro 11 minutes in. */
function pomodoro(title = LONG) {
  const t = today()
  t.tasks[ACTIVE] = { ...t.tasks[ACTIVE]!, title, technique: 'pomodoro 25/5', since: '2026-10-12T09:30:00+02:00' }
  return t
}

for (const [name, columns] of [['wide', 140], ['normal', 100], ['half', 70], ['third', 66]] as const) {
  test(`R17/R46: ${name} (${columns} columns): two rows that fit; the phase in words; every button with its name`, { options: OPTIONS }, async ($, on) => {
    world(on, { today: pomodoro() })
    await $.session.start(START)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...band(columns), surface })
      const [info, actions, ...more] = await rows(ui)
      expect(more).toEqual([])
      expect(info!.text).toContain('Pomodoro · work 11/25')
      expect(info!.text).toMatch(/T2 Ans/)
      expect(actions!.text).toContain('[Pause] [Done] [Wait] [Break] [Recap] [Tasks]')
      expect(info!.width).toBeLessThanOrEqual(columns)
      expect(actions!.width).toBeLessThanOrEqual(columns)
      await ui.unmount()
    }
  })
}

test('R17: a short title is kept whole, with the date and the progress, when there is room', { options: OPTIONS }, async ($, on) => {
  world(on, { today: pomodoro('Read section 3') })
  await $.session.start(START)
  const [info, actions] = await rows(await $.ui.mount({ ...band(100), surface: 'desktop' }))
  expect(info!.text).toBe('2026-10-12 1 of 3 done · T2 Read section 3 · Pomodoro · work 11/25')
  expect(actions!.text).toBe('[Pause] [Done] [Wait] [Break] [Recap] [Tasks] data 09:41')
})

test('R17: the long title is cut with an ellipsis before the phase is touched', { options: OPTIONS }, async ($, on) => {
  world(on, { today: pomodoro() })
  await $.session.start(START)
  const [info] = await rows(await $.ui.mount({ ...band(70), surface: 'desktop' }))
  expect(info!.text).toContain('… · Pomodoro · work 11/25')
  expect(info!.text).not.toContain(LONG)
})

test('R17: a narrow pane keeps every button, by its key; Tasks keeps its name', { options: OPTIONS }, async ($, on) => {
  world(on, { today: pomodoro() })
  await $.session.start(START)
  const [info, actions] = await rows(await $.ui.mount({ ...band(56), surface: 'desktop' }))
  expect(actions!.text).toBe('[P] [D] [W] [B] [R] [Tasks] 09:41')
  expect(info!.text).toContain('Pomodoro · work 11/25')
})

test('R17: very narrow, the labels shrink to their key, the secondary buttons go, Tasks stays', { options: OPTIONS }, async ($, on) => {
  world(on, { today: pomodoro() })
  await $.session.start(START)
  const [info, actions] = await rows(await $.ui.mount({ ...band(34), surface: 'terminal' }))
  expect(actions!.text).toBe('[P] [D] [Tasks] 09:41')
  expect(info!.text).toContain('Pomodoro · work 11/25')
})

test('R26/R25: Recap and Break are also in the Tasks pane, so a very narrow band loses nothing', { options: OPTIONS }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'pane-recap' })
  expect(w.forks).toHaveLength(1)
  await pane.press({ key: 'pane-break' })
  const ui = await $.ui.mount({ ...band(34), surface: 'desktop' })
  expect(await ui.find({ key: 'break-0' })).toBeDefined()
})

describe('fitRows', () => {
  const parts: BandParts = {
    date: '2026-10-12', progress: '2 of 13 done', progressShort: '2/13',
    title: `T3 ${LONG}`, phase: 'Pomodoro · work 19/25', extra: 'now: T9 Read the report elsewhere',
    buttons: [
      { key: 'pause', label: 'Pause', hotkey: 'p' }, { key: 'done', label: 'Done', hotkey: 'd' },
      { key: 'wait', label: 'Wait', hotkey: 'w', secondary: true }, { key: 'break', label: 'Break', hotkey: 'b', secondary: true },
      { key: 'recap', label: 'Recap', hotkey: 'r', secondary: true }, { key: 'tasks', label: 'Tasks', hotkey: 't', keep: true },
    ],
    asOf: 'data 09:41', asOfShort: '09:41',
  }

  test('from 40 to 200 columns both rows fit, the phase is whole, Tasks, Pause and Done stay', () => {
    for (let columns = 40; columns <= 200; columns += 1) {
      const lay = fitRows(columns, parts)
      expect(lay.info.width).toBeLessThanOrEqual(columns)
      expect(lay.actions.width).toBeLessThanOrEqual(columns)
      for (const key of ['tasks', 'pause', 'done']) expect(lay.actions.dropped).not.toContain(key)
      expect(buttonLabel(parts.buttons[5]!, lay.actions.compact)).toBe('Tasks')
    }
  })

  test('every button keeps its name from 63 columns up (six labels and the time)', () => {
    for (let columns = 63; columns <= 200; columns += 1) {
      const lay = fitRows(columns, parts)
      expect(lay.actions.compact).toBe(false)
      expect(lay.actions.dropped).toEqual([])
    }
  })

  test('the more room, the more each row keeps', () => {
    const kept = (c: number) => {
      const { info, actions } = fitRows(c, parts)
      const progress = info.progress === 'long' ? 2 : info.progress === 'short' ? 1 : 0
      return [
        (info.extra ? 4 : 0) + (info.date ? 2 : 0) + progress + info.title.length / 1000,
        (actions.asOf === 'long' ? 1 : 0) + (actions.compact ? 0 : 2) - actions.dropped.length,
      ]
    }
    for (let columns = 41; columns <= 200; columns += 1) {
      const [a, b] = [kept(columns - 1), kept(columns)]
      expect(b[0]!).toBeGreaterThanOrEqual(a[0]!)
      expect(b[1]!).toBeGreaterThanOrEqual(a[1]!)
    }
  })
})
