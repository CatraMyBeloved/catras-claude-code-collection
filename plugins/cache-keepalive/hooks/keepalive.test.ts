import { expect, mock, test } from 'claude-code/testing'
import type { RenderElement, RenderPropsOf } from 'claude-code'

import { CALM, decide, gaugeColor, emptyClock, formatLeft, resolveTtl, statusText, TTL_MS } from './keepalive'
import type { Situation } from './keepalive'

const sub = [{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 12 }]

test('auto TTL follows Claude Code precedence', async () => {
  expect(resolveTtl({ configured: 'auto', rateLimits: sub })).toBe('1h')
  expect(resolveTtl({ configured: 'auto', rateLimits: [] })).toBe('5m')
  expect(resolveTtl({ configured: 'auto', rateLimits: [{ kind: 'five_hour', percentUsed: 100 }] })).toBe('5m')
  expect(resolveTtl({ configured: 'auto', rateLimits: sub, force5m: '1', envTtl: '1h' })).toBe('5m')
  expect(resolveTtl({ configured: 'auto', rateLimits: [], envTtl: '1h', settingsTtl: '5m' })).toBe('1h')
  expect(resolveTtl({ configured: 'auto', rateLimits: sub, settingsTtl: '5m' })).toBe('5m')
  expect(resolveTtl({ configured: 'auto', rateLimits: [], enable1h: '1' })).toBe('1h')
  expect(resolveTtl({ configured: '5m', rateLimits: sub })).toBe('5m')
})

const base = (over: Partial<Situation> = {}): Situation => ({
  clock: { ...emptyClock, refreshedAt: 0, activeAt: 0 },
  now: 0,
  ttlMs: TTL_MS['5m'],
  leadMs: 20_000,
  maxIdleMs: 90 * 60_000,
  isRequesting: false,
  isTurnRunning: false,
  mode: 'prompt',
  isPinging: false,
  ...over,
})

test('pings inside the lead window, not before, not after expiry', async () => {
  expect(decide(base({ now: 60_000 })).kind).toBe('warm')
  expect(decide(base({ now: 285_000 })).kind).toBe('ping')
  expect(decide(base({ now: 300_000 })).kind).toBe('cold')
  expect(decide(base({ clock: emptyClock })).kind).toBe('unknown')
})

test('holds the ping while a request runs, while paused, idle or off', async () => {
  const due = 290_000
  expect(decide(base({ now: due, isRequesting: true })).kind).toBe('warm')
  expect(decide(base({ now: due, isPinging: true })).kind).toBe('warm')
  expect(decide(base({ now: due, mode: 'off' }))).toEqual({ kind: 'warm', leftMs: 10_000, held: 'off' })
  expect(decide(base({ now: due, clock: { ...emptyClock, refreshedAt: 0, activeAt: 0, isPaused: true } }))).toEqual({ kind: 'warm', leftMs: 10_000, held: 'paused' })
  // a prompt would only queue behind a running turn
  expect(decide(base({ now: due, isTurnRunning: true })).kind).toBe('warm')
  const now = 100 * 60_000
  const idle = base({ now, ttlMs: TTL_MS['1h'], clock: { ...emptyClock, refreshedAt: now - 3_590_000, activeAt: 0 } })
  expect(decide(idle)).toEqual({ kind: 'warm', leftMs: 10_000, held: 'idle' })
  expect(decide({ ...idle, maxIdleMs: 0 }).kind).toBe('ping')
})

test('the status reads as a countdown', async () => {
  expect(formatLeft(272_100)).toBe('4:33')
  expect(formatLeft(3_599_000)).toBe('59:59')
  expect(formatLeft(3_600_000)).toBe('1:00:00')
  expect(statusText({ kind: 'warm', leftMs: 61_000 }, '5m')).toBe('cache ▰▰▱▱▱▱▱▱ 1:01 (5m)')
  expect(statusText({ kind: 'cold' }, '1h')).toBe('cache ▱▱▱▱▱▱▱▱ cold (1h)')
  expect(statusText({ kind: 'unknown' }, '1h')).toBe(undefined)
})

test('the keep-alive asks for a minimal acknowledgement, and only once the turn is over', async ($, on) => {
  const time = mock.clock(on)
  mock.env(on, {})
  const prompts: string[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('settings.read', async () => ({ value: {} }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('prompt.submit', async (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 40_000 } } as const
  })

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of step) void _
  await step.result

  // a long tool run keeps the turn open past the lead window: nothing is queued
  await time.advance(4 * 60_000 + 50_000)
  expect(prompts.length).toBe(0)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await time.advance(5_000)
  // one ask, not one per tick while its turn gets going
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Respond with only a minimal acknowledgement')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the gauge pane draws the cache and pauses on ${surface}`, async ($, on) => {
    mock.clock(on)
    mock.env(on, {})
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] } }))
    on('settings.read', async () => ({ value: {} }))
    on('command.register', async (_$, e) => ({ value: { command: e.name } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.log', () => ({ value: undefined }))
    on('ui.panes', () => ({ value: [] }))
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 38_000, cache_creation_input_tokens: 2_000 } } as const
    })

    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    for await (const _ of step) void _
    await step.result

    const props = { title: 'Prompt cache', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { bodyRows: 20, offset: 0, rows: 0 }, view: {} } as unknown as RenderPropsOf['Pane']
    const pane = await $.ui.mount({ plugin: 'cache-keepalive', surface, component: 'Pane', props, requestId: 'cache-keepalive' })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('warm · 1:00:00 left')
    expect(drawn).toContain('40.0k')
    expect(drawn).toContain('TTL 1h (auto)')
    expect((await pane.find({ key: 'pause' }))?.props.label).toBe('Pause')
    await pane.press({ key: 'pause' })
    expect((await pane.find({ key: 'pause' }))?.props.label).toBe('Resume')
    await pane.unmount()
  })
}

test('the gauge stays green until 10 minutes left, yellow until 3, then red', async () => {
  const hour = TTL_MS['1h']
  expect(gaugeColor(50 * 60_000, hour)).toBe(CALM.green)
  expect(gaugeColor(10 * 60_000 + 1, hour)).toBe(CALM.green)
  expect(gaugeColor(10 * 60_000, hour)).toBe(CALM.yellow)
  expect(gaugeColor(3 * 60_000 + 1, hour)).toBe(CALM.yellow)
  expect(gaugeColor(3 * 60_000, hour)).toBe(CALM.red)
  // a 5-minute cache keeps the proportions: yellow from 50s, red from 15s
  expect(gaugeColor(60_000, TTL_MS['5m'])).toBe(CALM.green)
  expect(gaugeColor(50_000, TTL_MS['5m'])).toBe(CALM.yellow)
  expect(gaugeColor(15_000, TTL_MS['5m'])).toBe(CALM.red)
})

test('the footer keeps the mode labels and draws the bar green, then sand, then rose', async ($, on) => {
  const time = mock.clock(on)
  mock.env(on, {})
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] } }))
  on('settings.read', async () => ({ value: {} }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 38_000, cache_creation_input_tokens: 2_000 } } as const
  })
  // the engine's own footer, beneath the plugin
  on('ui.render', (_$, e) => {
    const { Text } = _$.ui.resolve(e)
    return h(Text, { dimColor: true }, 'focus') as RenderElement
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const footer = await $.ui.mount({ plugin: 'cache-keepalive', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
  // before the first request there is nothing to show: the engine's labels alone
  expect(JSON.stringify(await footer.drawn())).not.toContain('cache')

  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of step) void _
  await step.result

  const colorAt = async () => {
    await footer.redraw()
    const bar = await footer.find({ type: 'Text', text: /^cache/ })
    return bar?.props.color
  }
  expect(await colorAt()).toBe(CALM.green)
  expect(await footer.find({ text: 'focus' })).toBeDefined()
  await time.advance(51 * 60_000)
  expect(await colorAt()).toBe(CALM.yellow)
  await time.advance(7 * 60_000)
  expect(await colorAt()).toBe(CALM.red)
  await footer.unmount()
})

test('a lead longer than the cache lifetime never pings right after a request', { options: { leadSeconds: 400 } }, async ($, on) => {
  const time = mock.clock(on)
  mock.env(on, {})
  const prompts: string[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('settings.read', async () => ({ value: {} }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 40_000 } } as const
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of step) void _
  await step.result

  // 400s of lead on a 5m cache is held to half the lifetime: nothing until 2:30 are left
  await time.advance(140_000)
  expect(prompts.length).toBe(0)
  await time.advance(15_000)
  expect(prompts.length).toBe(1)
})
