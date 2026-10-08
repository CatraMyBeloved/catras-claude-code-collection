import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteResult, On } from 'claude-code'

import { parseScene } from './scene'
import { Stage } from './stage'
import { MAX_SCENERY_CHANGES, describeWorld, findProp, withProp, worldChangeFrom } from './world'
import type { SessionWorld } from './world'

const CAMP: SessionWorld = {
  setting: 'desert',
  hat: 'straw',
  props: [
    { id: 'cactus0', kind: 'cactus', x: 24 },
    { id: 'scroll1', kind: 'scroll', x: 44, label: 'notes' },
    { id: 'chest2', kind: 'chest', x: 64 },
  ],
}

test('the tool finds a prop by id, label or kind, and says what is there when it cannot', async () => {
  expect(findProp(CAMP, 'scroll1')?.id).toBe('scroll1')
  expect(findProp(CAMP, 'Notes')?.id).toBe('scroll1')
  expect(findProp(CAMP, 'chest')?.id).toBe('chest2')
  const missing = worldChangeFrom({ action: 'prop', prop: 'dragon', into: 'computer' }, CAMP)
  expect('error' in missing && missing.error).toContain('scroll1 (scroll "notes")')
})

test('a prop change names a real kind, and a no-op is refused', async () => {
  expect(worldChangeFrom({ action: 'prop', prop: 'notes', into: 'computer', label: 'npm test' }, CAMP))
    .toEqual({ kind: 'prop', id: 'scroll1', into: 'computer', label: 'npm test' })
  expect('error' in worldChangeFrom({ action: 'prop', prop: 'notes', into: 'spaceship' }, CAMP)).toBe(true)
  expect('error' in worldChangeFrom({ action: 'prop', prop: 'chest', into: 'chest' }, CAMP)).toBe(true)
  const changed = withProp(CAMP, 'scroll1', 'computer', 'npm test')
  expect(describeWorld(changed)).toContain('scroll1 (computer "npm test")')
  expect(CAMP.props[1]!.kind).toBe('scroll') // the old world is left as it was
})

test('new scenery brings its own props: the ones asked for, else fitting ones', async () => {
  const asked = worldChangeFrom({ action: 'scenery', setting: 'space', props: [{ kind: 'flag', label: 'v2' }, { kind: 'dragon' }, { kind: 'lamp' }] }, CAMP)
  if (!('kind' in asked) || asked.kind !== 'scenery') throw new Error('expected scenery')
  expect(asked.world.setting).toBe('space')
  expect(asked.world.props.map(p => p.kind)).toEqual(['flag', 'lamp']) // unknown kinds are left out
  expect(asked.world.hat).toBe('straw') // the hat stays unless a new one is asked for
  const picked = worldChangeFrom({ action: 'scenery', setting: 'cave', hat: 'miner' }, CAMP, () => 0.3)
  if (!('kind' in picked) || picked.kind !== 'scenery') throw new Error('expected scenery')
  expect(picked.world.props.length).toBe(4)
  expect(picked.world.hat).toBe('miner')
  expect('error' in worldChangeFrom({ action: 'scenery', setting: 'desert' }, CAMP)).toBe(true)
  expect('error' in worldChangeFrom({ action: 'prop', prop: 'x', into: 'rock' }, null)).toBe(true)
  expect(worldChangeFrom({ action: 'look' }, null)).toEqual({ kind: 'look' })
})

test('the director cannot change the world: transform and squash are dropped from its scenes', async () => {
  const world = { setting: 'desert' as const, props: CAMP.props }
  const raw = JSON.stringify({ beats: [{ do: 'transform', at: 'scroll1', into: 'computer' }, { do: 'squash', at: 'chest2' }, { do: 'carry', at: 'chest2' }, { do: 'drop' }] })
  const kept = parseScene(raw, world, { keepWorld: true })
  if ('error' in kept) throw new Error(kept.error)
  expect(kept.beats.map(b => b.do)).toEqual(['carry', 'drop'])
  const free = parseScene(raw, world)
  if ('error' in free) throw new Error(free.error)
  expect(free.beats.map(b => b.do)).toContain('transform') // the demo and the stage still know them
})

// ---- on stage ----

const run = (stage: Stage, from: number, ms: number) => {
  for (let t = from; t <= from + ms; t += 50) {
    stage.step(t)
    stage.frame(80, 10)
  }
  return from + ms
}

const inWorld = (w: SessionWorld) => ({ setting: w.setting, mood: 'neutral' as const, props: w.props.map(p => ({ ...p })), hat: w.hat, beats: [{ do: 'wait' as const, secs: 1 }] })

test('a prop change: he lifts it and it becomes the new thing', async () => {
  const stage = new Stage(() => 0)
  stage.frame(80, 10)
  stage.queue(inWorld(CAMP))
  let t = run(stage, 100_000, 3000)
  stage.changeProp('scroll1', 'computer', 'npm test')
  t = run(stage, t, 12_000)
  const prop = stage.world().props.find(p => p.id === 'scroll1')!
  expect(prop.kind).toBe('computer')
  expect(prop.label).toBe('npm test')
  expect(stage.world().setting).toBe('desert')
})

test('new scenery: a door appears, he walks through it, and steps out into the new place', async () => {
  const stage = new Stage(() => 0)
  stage.frame(80, 10)
  stage.queue(inWorld(CAMP))
  let t = run(stage, 200_000, 3000)
  const space: SessionWorld = { setting: 'space', hat: 'wizard', props: [{ id: 'flag0', kind: 'flag', x: 50 }] }
  stage.changeScenery(inWorld(space))
  expect(stage.isTravelling).toBe(true)
  // the director already asks in the new world while he is on his way
  expect(stage.world().setting).toBe('space')
  // the door stands while he walks to it; the old world is still on screen
  t = run(stage, t, 1500)
  expect(stage.isTravelling).toBe(true)
  t = run(stage, t, 15_000)
  expect(stage.isTravelling).toBe(false)
  expect(stage.world().setting).toBe('space')
  expect(stage.world().props.map(p => p.id)).toEqual(['flag0'])
  expect(stage.world().hat).toBe('wizard')
})

// ---- a whole session ----

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const camp = () => ({
  isAnswered: true,
  text: JSON.stringify({ setting: 'desert', hat: 'straw', props: [{ id: 'c', kind: 'cactus', x: 30 }, { id: 's', kind: 'scroll', x: 60, label: 'notes' }], beats: [{ do: 'look', at: 's' }] }),
  usage: USAGE,
}) as ModelCompleteResult

async function session($: Engine, on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const asks: string[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('model.complete', async (_$, e) => {
    asks.push(String(e.prompt))
    // the director tries to move to space and adds props of its own: the session's world holds
    return { value: asks.length === 1 ? camp() : { ...camp(), text: JSON.stringify({ setting: 'space', props: [{ id: 'x', kind: 'flag', x: 10 }], beats: [{ do: 'wait', secs: 1 }] }) } }
  })
  on('ui.log', async () => ({ value: undefined }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__agent-comic__${e.name}` } }))
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const turn = (text: string) => $.prompt.submit({ text } as Parameters<Engine['prompt']['submit']>[0])
  const done = () => $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' } as Parameters<Engine['turn']['complete']>[0])
  const change = async (input: object) => {
    const r = await $.tool.call({ tool: 'mcp__agent-comic__world_change', ...input } as unknown as Parameters<Engine['tool']['call']>[0])
    return String((r as { result?: unknown }).result)
  }
  return { clock, asks, turn, done, change }
}

test('the first turn sets up the world, and every later turn plays in it', async ($, on) => {
  const s = await session($, on)
  await s.turn('read the parser')
  await s.clock.advance(1000)
  expect(s.asks[0]).toContain('FIRST scene of the session')
  await s.done()
  await s.clock.advance(2000)
  await s.turn('now fix the bug')
  await s.clock.advance(1000)
  const opening = s.asks[s.asks.length - 1]!
  // hybrid: the model still stages the new turn's opening, in the same world
  expect(opening).toContain('now fix the bug')
  expect(opening).toContain("This session's world is set")
  expect(opening).toContain('setting desert')
  expect(opening).toContain('s = scroll "notes"')
  expect(await s.change({ action: 'look' })).toContain('Setting: desert')
})

test('only Claude changes the world: a prop, then the scenery, each told to the director', async ($, on) => {
  const s = await session($, on)
  await s.turn('read the docs')
  await s.clock.advance(1000)
  expect(await s.change({ action: 'prop', prop: 'notes', into: 'computer', label: 'tests' })).toContain('becomes a computer "tests"')
  await s.done()
  await s.clock.advance(2000)
  const wrap = s.asks[s.asks.length - 1]!
  expect(wrap).toContain('s = computer "tests"')

  await s.turn('ship it')
  expect(await s.change({ action: 'scenery', setting: 'beach', props: [{ kind: 'chest' }, { kind: 'flag', label: 'v2' }] })).toContain('walks through into the beach')
  await s.clock.advance(1000)
  await s.done()
  await s.clock.advance(2000)
  const later = s.asks[s.asks.length - 1]!
  expect(later).toContain('setting beach')
  expect(later).toContain('flag "v2"')

  for (let n = 1; n < MAX_SCENERY_CHANGES; n++) await s.change({ action: 'scenery', setting: n % 2 ? 'cave' : 'night' })
  expect(await s.change({ action: 'scenery', setting: 'space' })).toContain('Not changed')
})
