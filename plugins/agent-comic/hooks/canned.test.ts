import { expect, test } from 'claude-code/testing'

import { cannedFirst, cannedInterlude, cannedScene, cannedWrap } from './canned'
import type { Activity, World } from './canned'
import { SETTINGS } from './scene'
import type { Prop, Scene } from './scene'
import { Stage } from './stage'

/** mulberry32: a small seeded PRNG. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 1)

const ACTS: Activity[] = [
  { kind: 'read', label: 'a.ts' }, { kind: 'search', label: 'foo' }, { kind: 'edit', label: 'b.ts' }, { kind: 'run' }, { kind: 'web' },
  { kind: 'test', ok: true }, { kind: 'test', ok: false }, { kind: 'fail' }, { kind: 'helper' }, { kind: 'commit' }, { kind: 'push' },
  { kind: 'said', text: 'I found the cause: the cache key ignores the locale, so every language shares one entry.' },
]

const FULL: Prop[] = [
  { id: 'c', kind: 'computer', x: 30 }, { id: 'b', kind: 'bug', x: 50 }, { id: 'k', kind: 'crate', x: 70 }, { id: 'r', kind: 'rock', x: 90 },
]
const worlds = (seed: number): World[] => [
  ...SETTINGS.map(setting => {
    const first = cannedFirst('fix the bug', [], seeded(seed))
    return { setting, props: first.props }
  }),
  { setting: 'cave', props: FULL },
  { setting: 'meadow', props: [] },
]

function check(scene: Scene, world?: World) {
  expect(scene.beats.length).toBeGreaterThan(0)
  expect(scene.beats.length).toBeLessThanOrEqual(5)
  if (!world) return
  expect(scene.continues).toBe(true)
  expect(scene.setting).toBe(world.setting)
  const ids = new Set(world.props.map(p => p.id))
  for (const b of scene.beats) {
    if ('at' in b && b.at !== undefined && b.do !== 'pull_sign') expect(ids.has(b.at) || scene.props.some(p => p.id === b.at)).toBe(true)
    if (b.do === 'plant_sign') ids.add(b.id)
  }
  expect(scene.beats.filter(b => b.do === 'plant_sign').length).toBeLessThanOrEqual(1)
}

test('every activity in every world parses, targets only existing props, and stays short', async () => {
  for (const seed of SEEDS) {
    for (const world of worlds(seed)) {
      for (const a of ACTS) check(cannedScene([a], world, seeded(seed)), world)
      check(cannedScene(ACTS, world, seeded(seed)), world)
      check(cannedScene([], world, seeded(seed)), world)
      for (let n = 1; n <= 5; n++) check(cannedInterlude(world, n, seeded(seed + n)), world)
      check(cannedWrap(world, undefined, false, seeded(seed)), world)
      check(cannedWrap(world, 'All the tests pass now, and the cache key includes the locale as it should.', false, seeded(seed)), world)
      check(cannedWrap(world, undefined, true, seeded(seed)), world)
    }
  }
})

test('the opening scene sets up a world of its own and avoids the latest setting', async () => {
  for (const seed of SEEDS) {
    for (const last of SETTINGS) {
      const scene = cannedFirst('please fix the crash in the parser', [last], seeded(seed))
      check(scene)
      expect(scene.setting).not.toBe(last)
      expect(scene.continues).toBeUndefined()
      expect(scene.props.length).toBe(4)
      expect(new Set(scene.props.map(p => p.id)).size).toBe(4)
    }
    const history = SETTINGS.slice(0, 7)
    expect(history.slice(-3)).not.toContain(cannedFirst('', history, seeded(seed)).setting) // not among the last three turns' settings
    expect(cannedFirst('update the README docs', ['cave'], () => 0).setting).toBe('library')
  }
})

test('a wrap-up with an abort never celebrates, and says the last remark clipped', async () => {
  const world: World = { setting: 'forest', props: FULL }
  const said = 'That should be everything for the migration, though the old table can stay around for now.'
  for (const seed of SEEDS) {
    const aborted = cannedWrap(world, said, true, seeded(seed))
    expect(aborted.beats.some(b => b.do === 'celebrate' || b.do === 'dance')).toBe(false)
    const done = cannedWrap(world, said, false, seeded(seed))
    const say = done.beats.find(b => b.do === 'say')
    expect(say && 'text' in say ? say.text.length : 99).toBeLessThanOrEqual(60)
    expect(done.beats.some(b => b.do === 'celebrate' || b.do === 'wave' || (b.do === 'emote' && b.mood === 'happy'))).toBe(true)
  }
})

test('failures show worry, passing tests celebrate, and the same input varies with the seed', async () => {
  const world: World = { setting: 'cave', props: FULL }
  expect(cannedScene([{ kind: 'test', ok: false }], world, seeded(3)).mood).toBe('worried')
  const green = cannedScene([{ kind: 'fail' }, { kind: 'test', ok: true }], world, seeded(3))
  expect(green.mood).toBe('worried') // the failure is the most salient thing
  const pass = cannedScene([{ kind: 'test', ok: true }], world, seeded(3))
  // the world stays as it is: no canned scene squashes or transforms a prop
  expect(pass.beats.map(b => b.do)).not.toContain('squash')
  for (const seed of SEEDS) {
    for (const scene of [cannedScene(ACTS, world, seeded(seed)), cannedInterlude(world, 1, seeded(seed)), cannedWrap(world, 'done', false, seeded(seed))]) {
      expect(scene.beats.some(b => b.do === 'squash' || b.do === 'transform')).toBe(false)
    }
  }
  expect(pass.beats.map(b => b.do)).toContain('celebrate')
  const shapes = new Set(SEEDS.map(s => JSON.stringify(cannedScene([{ kind: 'read' }, { kind: 'edit' }], world, seeded(s)).beats)))
  expect(shapes.size).toBeGreaterThan(3)
  const same = JSON.stringify(cannedScene(ACTS, world, seeded(5)))
  expect(JSON.stringify(cannedScene(ACTS, world, seeded(5)))).toBe(same)
})

test('canned scenes play through the real stage without throwing', async () => {
  const s = new Stage(() => 0.5)
  s.frame(90, 10)
  const first = cannedFirst('add a test for the cache', ['cave'], seeded(11))
  s.queue(first)
  let t = 20_000_000
  const play = (ms: number) => {
    for (const end = t + ms; t < end; t += 50) {
      s.step(t)
      expect(s.frame(90, 10).length).toBeGreaterThan(0)
    }
  }
  play(12_000)
  for (const a of ACTS) {
    s.queue(cannedScene([a], s.world(), seeded(t)))
    play(10_000)
  }
  s.queue(cannedScene(ACTS, s.world(), seeded(9)))
  play(10_000)
  for (let n = 1; n <= 4; n++) {
    s.queue(cannedInterlude(s.world(), n, seeded(n)))
    play(8_000)
  }
  s.queue(cannedWrap(s.world(), 'All done here.', false, seeded(2)))
  play(10_000)
  s.queue(cannedWrap(s.world(), undefined, true, seeded(2)))
  play(8_000)
  expect(s.world().setting).toBe(first.setting)
})
