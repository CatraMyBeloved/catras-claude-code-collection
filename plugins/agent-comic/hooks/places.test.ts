import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On, RenderElement, RenderPropsOf } from 'claude-code'

import { HUB, asPlace, enteringFrom, kit, routeOf, withPlace, withoutPlace } from './places'

const garden = { id: 'garden', name: 'Garden' }
const pond = { id: 'pond', name: 'Pond' }

test('the ring starts at the hub and keeps its places in id order, renamed in place', async () => {
  let ring = withPlace([HUB], pond)
  ring = withPlace(ring, garden)
  expect(ring.map(s => s.id)).toEqual([null, 'garden', 'pond'])
  ring = withPlace(ring, { id: 'pond', name: 'Fishing pond' })
  expect(ring.map(s => s.name)).toEqual(['Hub', 'Garden', 'Fishing pond'])
  expect(withoutPlace(ring, 'garden').map(s => s.id)).toEqual([null, 'pond'])
})

test('signs: none at the hub alone, one each way with one place, both ways round a ring', async () => {
  expect(routeOf([HUB], null)).toEqual({ left: null, right: null })
  const two = withPlace([HUB], pond)
  expect(routeOf(two, null)).toEqual({ left: null, right: pond })
  expect(routeOf(two, 'pond')).toEqual({ left: HUB, right: null })
  const three = withPlace(two, garden)
  expect(routeOf(three, null)).toEqual({ left: pond, right: garden })
  expect(routeOf(three, 'garden')).toEqual({ left: HUB, right: pond })
  expect(routeOf(three, 'pond')).toEqual({ left: garden, right: HUB })
  // a place no longer on the ring reads as the hub
  expect(routeOf(three, 'gone')).toEqual(routeOf(three, null))
  expect(enteringFrom(1)).toBe(-1)
})

test('a place is checked before it is drawn: names are cut to a sign, junk is no place', async () => {
  expect(asPlace({ id: 'x', name: 'A very long name for a little sign' })?.name.length).toBeLessThanOrEqual(16)
  expect(asPlace({ id: '', name: 'x' })).toBe(null)
  expect(asPlace({ id: 'x' })).toBe(null)
  expect(asPlace(null)).toBe(null)
})

test('the kit is plain data: Claude 11 wide, every letter in his palette', async () => {
  const k = kit()
  expect(JSON.parse(JSON.stringify(k))).toEqual(k)
  for (const frame of [k.claude.stand, k.claude.blink, k.claude.asleep, ...k.claude.walk]) {
    for (const row of frame) {
      expect(row.length).toBe(11)
      for (const ch of row) if (ch !== '.') expect(k.claude.palette[ch]).toBeDefined()
    }
  }
  expect(k.claude.walk.length).toBe(4)
  expect(Object.keys(k.hats)).toContain('wizard')
})

// A place as another plugin would write it: it signs on at session start, draws the band only
// while it is `here` and the band is idle, and says it is alive each second unless broken.
const pondPlugin: Plugin = {
  name: 'pond',
  register(on) {
    let isBroken = false
    on('session.start', async ($, e, next) => {
      try {
        await $.comic.addPlace({ id: 'pond', name: 'Pond' })
      } catch {
        // no comic: the pond would draw on its own
      }
      $.clock.every(1000, async () => {
        const { value: at } = await $.state.get({ plugin: 'agent-comic', key: 'here' })
        if (!isBroken && at === 'pond') await $.comic.alive({ id: 'pond', name: 'Pond' })
      })
      return next(e)
    })
    on('command.run', { command: 'pond-break' }, async () => {
      isBroken = true
      return { text: 'broken' }
    })
    on('command.run', { command: 'pond-route' }, async $ => ({ text: JSON.stringify(await $.comic.route()) }))
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { value: at } = await $.state.get({ plugin: 'agent-comic', key: 'here' })
      const { value: state } = await $.state.get({ plugin: 'agent-comic', key: 'state' })
      if (at !== 'pond' || state !== 'idle' || e.props.isWorking) return next(e)
      const { Text } = $.ui.resolve(e)
      return h(Text, { key: 'pond' }, 'fishing') as RenderElement
    })
  },
}

const band = (isWorking: boolean) =>
  ({
    hasSurvey: false,
    isWorking,
    maxRows: 14,
    bodyColumns: 90,
    scroll: { bodyRows: 13, offset: 0, rows: 0 },
    view: {},
  }) as unknown as RenderPropsOf['AbovePrompt']

/** The engine stood in for: the clock, the store, the calls the comic makes at session start. */
async function session($: Engine, on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__agent-comic__${e.name}` } }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.log', async () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, 'engine') as RenderElement
  })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const turn = () => $.prompt.submit({ text: 'fix it' } as Parameters<Engine['prompt']['submit']>[0])
  const done = () =>
    $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' } as Parameters<Engine['turn']['complete']>[0])
  const command = (command: string) => $.command.run({ command, args: '' } as unknown as Parameters<Engine['command']['run']>[0])
  return { clock, turn, done, command }
}

/** Presses a sign on the band, as the person would with its hotkey. */
async function follow($: Engine, key: 'sign-left' | 'sign-right') {
  const mounted = await $.ui.mount({ plugin: 'agent-comic', surface: 'terminal', component: 'AbovePrompt', props: band(false) })
  await $.ui.press({ plugin: 'agent-comic', key })
  await mounted.unmount()
}

/** What the band shows: the comic's stage (with its sign text), the pond, or the engine's own. */
async function shown($: Engine, isWorking = false) {
  const mounted = await $.ui.mount({ plugin: 'agent-comic', surface: 'terminal', component: 'AbovePrompt', props: band(isWorking) })
  const raster = (await mounted.find({ key: 'stage' })) as unknown as { props: { cells: string } } | undefined
  const isFishing = (await mounted.find({ type: 'Text', text: 'fishing' })) != null
  const keys = { left: (await mounted.find({ key: 'sign-left' })) != null, right: (await mounted.find({ key: 'sign-right' })) != null }
  await mounted.unmount()
  return { what: raster ? 'comic' : isFishing ? 'pond' : 'nothing', text: raster ? cellsText(raster.props.cells) : '', keys }
}

function cellsText(cells: string): string {
  const bin = atob(cells)
  const u32 = new Uint32Array(bin.length / 4)
  for (let i = 0; i < u32.length; i++) {
    u32[i] = bin.charCodeAt(i * 4) | (bin.charCodeAt(i * 4 + 1) << 8) | (bin.charCodeAt(i * 4 + 2) << 16) | (bin.charCodeAt(i * 4 + 3) << 24)
  }
  let out = ''
  for (let i = 0; i < u32.length; i += 3) out += u32[i] ? String.fromCodePoint(u32[i]!) : ' '
  return out
}

// reads the comic's state as another plugin does
const probe: Plugin = {
  name: 'probe',
  register(on) {
    on('command.run', { command: 'probe' }, async $ => {
      const here = (await $.state.get({ plugin: 'agent-comic', key: 'here' })).value ?? null
      const state = (await $.state.get({ plugin: 'agent-comic', key: 'state' })).value ?? null
      const cameFrom = (await $.state.get({ plugin: 'agent-comic', key: 'cameFrom' })).value ?? null
      return { text: JSON.stringify({ here, state, cameFrom }) }
    })
  },
}

async function state($: Engine, key: 'here' | 'state' | 'cameFrom') {
  const out = (await $.command.run({ command: 'probe', args: '' } as unknown as Parameters<Engine['command']['run']>[0])) as { text: string }
  return (JSON.parse(out.text) as Record<string, unknown>)[key]
}

test('with no place, the band between turns is the comic as before: no signs', { options: { director: 'off' }, plugins: [probe] }, async ($, on) => {
  await session($, on)
  const band = await shown($)
  expect(band.what).toBe('comic')
  expect(band.keys).toEqual({ left: false, right: false })
  expect(band.text).not.toContain('▸')
  expect(await state($, 'state')).toBe('idle')
  expect(await state($, 'here')).toBe(null)
})

test('a place signs on: the hub shows its sign, and following it hands the band over', { options: { director: 'off' }, plugins: [pondPlugin, probe] }, async ($, on) => {
  const s = await session($, on)
  let band = await shown($)
  expect(band.what).toBe('comic')
  expect(band.keys).toEqual({ left: false, right: true })
  expect(band.text).toContain('Pond ▸')
  expect(JSON.stringify(await s.command('pond-route'))).toContain('Pond')

  await follow($, 'sign-right')
  expect(await state($, 'here')).toBe('pond')
  expect(await state($, 'cameFrom')).toBe(-1) // he walked out right, so he comes in from the left
  band = await shown($)
  expect(band.what).toBe('pond')
})

test('work takes the band back from a place; once the wrap-up is over it goes back there', { options: { director: 'off' }, plugins: [pondPlugin, probe] }, async ($, on) => {
  const s = await session($, on)
  await follow($, 'sign-right')
  await s.turn()
  expect(await state($, 'state')).toBe('working')
  expect((await shown($, true)).what).toBe('comic')
  await s.done()
  expect(await state($, 'state')).toBe('wrapping')
  expect((await shown($)).what).toBe('comic')
  await s.clock.advance(26_000)
  expect(await state($, 'state')).toBe('idle')
  expect(await state($, 'here')).toBe('pond')
  expect((await shown($)).what).toBe('pond')
})

test('a place that stops drawing sends Claude home to the hub', { options: { director: 'off' }, plugins: [pondPlugin, probe] }, async ($, on) => {
  const s = await session($, on)
  await follow($, 'sign-right')
  await s.clock.advance(10_000)
  expect(await state($, 'here')).toBe('pond') // alive every second: it stays
  await s.command('pond-break')
  await s.clock.advance(7_000)
  expect(await state($, 'here')).toBe(null)
  expect((await shown($)).what).toBe('comic')
})

test('with "Show when idle" off the band stays hidden between turns, places too', { options: { director: 'off', showWhenIdle: false }, plugins: [pondPlugin, probe] }, async ($, on) => {
  await session($, on)
  expect(await state($, 'state')).toBe('hidden')
  expect((await shown($)).what).toBe('nothing')
})
