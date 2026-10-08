import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteResult, On } from 'claude-code'

import { buildPrompt } from './director'
import { parseScene } from './scene'
import type { Prop, Scene } from './scene'
import { Stage } from './stage'
import { WORLD_LIMITS, changesLeft, followWorld, limitChanges, noChanges } from './world'

const PROPS: Prop[] = [
  { id: 'cactus0', kind: 'cactus', x: 24 },
  { id: 'scroll1', kind: 'scroll', x: 44, label: 'notes' },
  { id: 'chest2', kind: 'chest', x: 64 },
]
const DESERT = { setting: 'desert' as const, props: PROPS }

const parse = (beats: object[], changes: 'none' | 'director') => {
  const s = parseScene(JSON.stringify({ beats }), DESERT, { changes })
  if ('error' in s) throw new Error(s.error)
  return s
}

test('the director may transform a prop, swap the hat and travel; canned scenes may not; nobody squashes', async () => {
  const beats = [
    { do: 'transform', at: 'scroll1', into: 'computer', label: 'tests' },
    { do: 'hat', hat: 'miner' },
    { do: 'squash', at: 'chest2' },
    { do: 'travel', setting: 'space', props: [{ kind: 'flag', label: 'v2' }, { kind: 'dragon' }], hat: 'wizard' },
    { do: 'wave' }, // after the door: belongs to the old place, dropped
  ]
  const director = parse(beats, 'director')
  expect(director.beats.map(b => b.do)).toEqual(['transform', 'hat', 'travel'])
  const travel = director.beats[2] as Extract<Scene['beats'][number], { do: 'travel' }>
  expect(travel.setting).toBe('space')
  expect(travel.props.map(p => p.kind)).toEqual(['flag']) // unknown kinds left out
  expect(travel.hat).toBe('wizard')
  expect(parse(beats, 'none').beats.map(b => b.do)).toEqual(['wave'])
  // travelling to where he already is: no travel
  expect(parse([{ do: 'travel', setting: 'desert' }, { do: 'wave' }], 'director').beats.map(b => b.do)).toEqual(['wave'])
})

test('world changes are held to the session limits, and an empty travel gets fitting props', async () => {
  const scene = parse([
    { do: 'hat', hat: 'miner' }, { do: 'hat', hat: 'miner' }, { do: 'transform', at: 'scroll1', into: 'computer' }, { do: 'travel', setting: 'cave' },
  ], 'director')
  const first = limitChanges({ ...scene, hat: 'straw' }, noChanges(), () => 0.3)
  expect(first.used).toEqual({ transform: 1, hat: 1, travel: 1 }) // the second miner hat is no change
  const travel = first.scene.beats.find(b => b.do === 'travel') as Extract<Scene['beats'][number], { do: 'travel' }>
  expect(travel.props.length).toBe(4)
  const spent = { transform: WORLD_LIMITS.transform, hat: WORLD_LIMITS.hat, travel: WORLD_LIMITS.travel }
  const none = limitChanges({ ...scene, hat: 'straw' }, spent)
  expect(none.scene.beats.map(b => b.do)).toEqual(['ponder'])
  expect(changesLeft(first.used)).toEqual({ transform: WORLD_LIMITS.transform - 1, hat: WORLD_LIMITS.hat - 1, travel: WORLD_LIMITS.travel - 1 })
})

test('the request shows the director the world as it is, what he wears, and the changes left', async () => {
  const prompt = buildPrompt({
    goal: 'fix it', log: ['read a.ts'], fresh: 1, previous: null, finished: false,
    world: { setting: 'desert', props: PROPS, gone: [], hat: 'straw' }, changesLeft: { transform: 5, hat: 4, travel: 1 },
  })
  expect(prompt).toContain('Claude wears: straw')
  expect(prompt).toContain('scroll1 = scroll "notes"')
  expect(prompt).toContain('transform 5, hat 4, travel 1')
})

// ---- on stage ----

const run = (stage: Stage, from: number, ms: number) => {
  for (let t = from; t <= from + ms; t += 50) {
    stage.step(t)
    stage.frame(80, 10)
  }
  return from + ms
}
const inDesert = (beats: Scene['beats']): Scene => ({ setting: 'desert', mood: 'neutral', props: PROPS.map(p => ({ ...p })), hat: 'straw', beats })

test('on stage a hat beat swaps the hat and a transform changes the prop, each told as it plays', async () => {
  const stage = new Stage(() => 0)
  const told: string[] = []
  stage.onWorldChange = w => told.push(`${w.hat}/${w.props.find(p => p.id === 'scroll1')?.kind}`)
  stage.frame(80, 10)
  stage.queue(inDesert([{ do: 'hat', hat: 'miner' }, { do: 'transform', at: 'scroll1', into: 'computer', label: 'tests' }]))
  run(stage, 100_000, 15_000)
  expect(stage.world().hat).toBe('miner')
  expect(stage.world().props.find(p => p.id === 'scroll1')?.kind).toBe('computer')
  expect(told).toEqual(['miner/scroll', 'miner/computer'])
})

test('a travel beat: a door appears, he walks through it, and steps out into the new place', async () => {
  const stage = new Stage(() => 0)
  const told: string[] = []
  stage.onWorldChange = w => told.push(w.setting)
  stage.frame(80, 10)
  stage.queue(inDesert([{ do: 'wait', secs: 1 }, { do: 'travel', setting: 'space', props: [{ id: 'flag0', kind: 'flag', x: 50 }], hat: 'wizard' }]))
  let t = run(stage, 200_000, 3500)
  expect(stage.isTravelling).toBe(true)
  t = run(stage, t, 15_000)
  expect(stage.isTravelling).toBe(false)
  expect(stage.world().setting).toBe('space')
  expect(stage.world().props.map(p => p.id)).toEqual(['flag0'])
  expect(stage.world().hat).toBe('wizard')
  expect(told).toEqual(['space'])
})

// ---- a whole session ----

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const reply = (o: object) => ({ isAnswered: true, text: JSON.stringify(o), usage: USAGE }) as ModelCompleteResult

async function session($: Engine, on: On, answers: object[]) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const asks: string[] = []
  const tools: string[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('model.complete', async (_$, e) => {
    asks.push(String(e.prompt))
    return { value: reply(answers[Math.min(asks.length, answers.length) - 1]!) }
  })
  on('ui.log', async () => ({ value: undefined }))
  on('tool.register', async (_$, e) => {
    tools.push(e.name)
    return { value: { tool: `mcp__agent-comic__${e.name}` } }
  })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const turn = (text: string) => $.prompt.submit({ text } as Parameters<Engine['prompt']['submit']>[0])
  const done = () => $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' } as Parameters<Engine['turn']['complete']>[0])
  return { clock, asks, tools, turn, done }
}

const CAMP = { setting: 'desert', hat: 'straw', props: [{ id: 'c', kind: 'cactus', x: 30 }, { id: 's', kind: 'scroll', x: 60, label: 'notes' }], beats: [{ do: 'look', at: 's' }] }

test('the main agent gets no world tool: the world is the director\'s', async ($, on) => {
  const s = await session($, on, [CAMP])
  expect(s.tools).toEqual(['hub_add'])
})

test('the changes of the director are counted as its scenes land, and the next request says what is left', async ($, on) => {
  const s = await session($, on, [
    CAMP,
    { beats: [{ do: 'transform', at: 's', into: 'computer', label: 'tests' }, { do: 'hat', hat: 'miner' }, { do: 'travel', setting: 'beach' }] },
    { beats: [{ do: 'wave' }] },
  ])
  await s.turn('read the docs')
  await s.clock.advance(1000)
  expect(s.asks[0]).toContain('FIRST scene of the session')
  await s.done()
  await s.clock.advance(2000)
  await s.turn('now run the tests')
  await s.clock.advance(1000)
  const next = s.asks[s.asks.length - 1]!
  expect(next).toContain('now run the tests')
  expect(next).toContain(`transform ${WORLD_LIMITS.transform - 1}, hat ${WORLD_LIMITS.hat - 1}, travel ${WORLD_LIMITS.travel - 1}`)
})

test('what plays on stage is what the session keeps; a new place moves the turn along', async () => {
  const desert = { setting: 'desert' as const, hat: 'straw' as const, props: PROPS }
  const changed = followWorld(desert, { ...desert, hat: 'miner', props: PROPS.map(p => (p.id === 'scroll1' ? { ...p, kind: 'computer' as const } : p)) })
  expect(changed.moved).toBe(false)
  expect(changed.world.hat).toBe('miner')
  expect(changed.world.props[1]!.kind).toBe('computer')
  const moved = followWorld(desert, { setting: 'beach', hat: 'straw', props: [{ id: 'chest0', kind: 'chest', x: 30 }] })
  expect(moved.moved).toBe(true)
  expect(moved.world.setting).toBe('beach')
})
