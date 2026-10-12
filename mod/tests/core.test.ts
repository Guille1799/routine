// The pure logic, and the argv format pinned by a literal: tests/test_mod_contract.py
// builds the same argv in Python, so a change here must change it there too.
import { describe, expect, test } from 'claude-code/testing'

import { band, breakLeftMs, inboxText, readWriterAnswer, resolveTask, writerArgv } from '../hooks/core'
import { NOW, SESSION, today } from './world'

describe('writer argv', () => {
  test('is pinned: action with dashes, --task, --data JSON, --session, --cwd', () => {
    expect(writerArgv('py', { action: 'drift_warn', task: 't-1', data: { message: 'x' }, session: 's', cwd: 'D:/w' })).toEqual([
      'py', '-m', 'routine', 'drift-warn', '--task', 't-1', '--data', '{"message":"x"}', '--session', 's', '--cwd', 'D:/w',
    ])
    expect(writerArgv('python', { action: 'inbox', data: { text: 'a' } })).toEqual([
      'python', '-m', 'routine', 'inbox', '--data', '{"text":"a"}',
    ])
  })

  test('answers are read by exit code: 0 written, 1 refused, 2 no data folder', () => {
    expect(readWriterAnswer(0, '{"ok":true,"events":[1]}', '')).toEqual({ ok: true, events: [1] })
    expect(readWriterAnswer(1, '{"ok":false,"error":"no"}', '')).toEqual({ ok: false, reason: 'refused', error: 'no' })
    expect(readWriterAnswer(2, '{"ok":false,"error":"no data folder"}', '')).toEqual({ ok: false, reason: 'no-data', error: 'no data folder' })
    expect(readWriterAnswer(1, '', 'Traceback\nModuleNotFoundError: routine')).toEqual({ ok: false, reason: 'refused', error: 'ModuleNotFoundError: routine' })
  })
})

describe('T2 is a spoken alias', () => {
  test('T2, t2 and 2 are the second of today\'s order; an id passes; nothing else is guessed', () => {
    const t = today()
    expect(resolveTask(t, 'T2')).toBe('t-20261012-bbbbbb')
    expect(resolveTask(t, 't3')).toBe('t-20261012-cccccc')
    expect(resolveTask(t, '1')).toBe('t-20261012-aaaaaa')
    expect(resolveTask(t, 't-20261012-cccccc')).toBe('t-20261012-cccccc')
    expect(resolveTask(t, 'T4')).toBeUndefined()
    expect(resolveTask(t, 'the parser')).toBeUndefined()
    expect(resolveTask(t, undefined)).toBe('t-20261012-bbbbbb')
  })
})

describe('band', () => {
  test('dropped tasks do not count in "n of m"', () => {
    const t = today()
    t.tasks['t-20261012-cccccc']!.status = 'dropped'
    expect(band(t, NOW).progress).toBe('1 of 2 done')
  })

  test('the break ends minutes after its start, whatever the module saw', () => {
    const brk = { technique: 'pomodoro', minutes: 5, since: '2026-10-12T09:38:00+02:00' }
    expect(breakLeftMs(brk, NOW)).toBe(2 * 60000)
    expect(breakLeftMs({ ...brk, minutes: null }, NOW)).toBe(2 * 60000)
    expect(band(today({ break: brk }), NOW + 3 * 60000).break).toEqual({ leftMin: 0, isOver: true })
  })

  test('elapsed time is shown only when the writer says when the task started', () => {
    const t = today()
    delete t.tasks['t-20261012-bbbbbb']!.since
    expect(band(t, NOW, SESSION).task).toEqual({ id: 't-20261012-bbbbbb', alias: 'T2', title: 'Read section 3', elapsed: undefined, breakDue: false })
  })
})

describe('/inbox', () => {
  test('only a prompt that starts with /inbox is a capture', () => {
    expect(inboxText('/inbox buy milk')).toBe('buy milk')
    expect(inboxText('  /inbox  two\nlines ')).toBe('two\nlines')
    expect(inboxText('/inbox')).toBe('')
    expect(inboxText('/inboxes')).toBeUndefined()
    expect(inboxText('please /inbox this')).toBeUndefined()
  })
})
