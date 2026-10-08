import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteResult, On, RenderElement, RenderPropsOf } from 'claude-code'

import { Canvas, cellText } from './canvas'
import { buildPrompt, describeCall, varietyNotes } from './director'
import { addTiming, emptyTimings, formatTimings, nextAsk } from './pacing'
import type { AskState } from './pacing'
import { clip, parseScene } from './scene'
import { Stage, wrap } from './stage'
import { addHubItem } from './hub'
import type { HubItem } from './hub'
import { addUsage, asTally, emptyTally, formatStats, today } from './usage'

const band = (isWorking: boolean) =>
  ({
    hasSurvey: false,
    isWorking,
    maxRows: 14,
    bodyColumns: 90,
    scroll: { bodyRows: 13, offset: 0, rows: 0 },
    view: {},
  }) as unknown as RenderPropsOf['AbovePrompt']

test('a reply with prose around the JSON parses, and bad beats are dropped', async () => {
  const scene = parseScene(`Here you go:
    {"setting":"library","props":[{"id":"r","kind":"sign","x":60,"label":"README.md"},{"id":"x","kind":"dragon","x":10}],
     "beats":[{"do":"look","at":"r","react":"!"},{"do":"look","at":"x"},{"do":"say","text":"Found the docs!"},{"do":"fly"}]}`)
  expect('error' in scene).toBe(false)
  if ('error' in scene) return
  expect(scene.setting).toBe('library')
  expect(scene.props.length).toBe(1)
  expect(scene.beats.map(b => b.do)).toEqual(['look', 'say'])
})

test('a reply without beats is refused', async () => {
  expect('error' in parseScene('{"setting":"cave","props":[],"beats":[]}')).toBe(true)
  expect('error' in parseScene('no json at all')).toBe(true)
})

test('a frame encodes columns * rows cells of three u32 each', async () => {
  const c = new Canvas(7, 3)
  c.set(0, 0, 0xff0000)
  c.text(2, 1, 'hi', 0xffffff)
  const bytes = atob(c.encode()).length
  expect(bytes).toBe(7 * 3 * 3 * 4)
})

test('the stage plays a whole scene across many frames without throwing', async () => {
  const stage = new Stage()
  const scene = parseScene(JSON.stringify({
    setting: 'forest',
    props: [{ id: 'b', kind: 'bug', x: 70 }, { id: 's', kind: 'sign', x: 30, label: 'auth.ts' }],
    beats: [
      { do: 'look', at: 's', react: '?' }, { do: 'say', text: 'A null check is missing in auth.ts, line 42.' },
      { do: 'squash', at: 'b' }, { do: 'dig' }, { do: 'celebrate' }, { do: 'think', text: 'Tests next.' },
    ],
  }))
  if ('error' in scene) throw new Error(scene.error)
  stage.queue(scene)
  for (let t = 0; t < 40_000; t += 50) {
    stage.step(1_000_000 + t)
    expect(stage.frame(90, 10).length).toBeGreaterThan(0)
  }
})

test('speech wraps to the bubble width', async () => {
  expect(wrap('one two three four five', 9)).toEqual(['one two', 'three', 'four five'])
})

test('tool calls become readable log lines', async () => {
  const line = describeCall({ tool: 'Bash', tool_use_id: 'x', command: 'npm test' }, { isError: true, result: { stdout: '', stderr: '2 failing' } })
  expect(line).toBe('ran `npm test` -> FAILED: 2 failing')
})

test('the band shows the stage while Claude works and while idle', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, 'the engine band') as RenderElement
  })
  const working = await $.ui.mount({ plugin: 'agent-comic', surface: 'terminal', component: 'AbovePrompt', props: band(true) })
  expect(await working.find({ key: 'stage' })).toBeDefined()
  await working.unmount()

  const idle = await $.ui.mount({ plugin: 'agent-comic', surface: 'terminal', component: 'AbovePrompt', props: band(false) })
  expect(await idle.find({ key: 'stage' })).toBeDefined()
  await idle.unmount()
})

test('long remarks are cut at a word boundary, never mid-word', async () => {
  const text = 'The email helper sends whatever the agent drafts, and nothing checks how many it has sent this hour already.'
  const cut = clip(text, 60)
  expect(cut.length).toBeLessThan(61)
  expect(cut.endsWith('…')).toBe(true)
  expect(text.startsWith(cut.slice(0, -1))).toBe(true)
  expect(text[cut.length - 1]).toBe(' ')
})

test('moods and the new actions parse, and unknown moods are dropped', async () => {
  const scene = parseScene(JSON.stringify({
    setting: 'cave', mood: 'worried',
    props: [{ id: 'c', kind: 'computer', x: 60 }, { id: 'k', kind: 'crate', x: 20 }],
    beats: [
      { do: 'emote', mood: 'surprised' }, { do: 'emote', mood: 'hangry' }, { do: 'type', at: 'c' },
      { do: 'carry', at: 'k' }, { do: 'run', to: 90 }, { do: 'drop' }, { do: 'dance' }, { do: 'sleep', secs: 2 },
    ],
  }))
  if ('error' in scene) throw new Error(scene.error)
  expect(scene.mood).toBe('worried')
  expect(scene.beats.map(b => b.do)).toEqual(['emote', 'type', 'carry', 'run', 'drop', 'dance', 'emote'])
  expect(scene.beats.at(-1)).toEqual({ do: 'emote', mood: 'sleepy', secs: 2 }) // a stray sleep is the sleepy mood
})

test('every mood and action plays through without throwing', async () => {
  const moods = ['happy', 'proud', 'love', 'sad', 'angry', 'surprised', 'confused', 'sleepy', 'focused', 'worried']
  const scene = parseScene(JSON.stringify({
    setting: 'library', mood: 'happy',
    props: [{ id: 'c', kind: 'computer', x: 70 }, { id: 'k', kind: 'crate', x: 20 }],
    beats: [
      { do: 'read' }, { do: 'type', at: 'c' }, { do: 'carry', at: 'k' }, { do: 'run', to: 90 }, { do: 'drop' },
      { do: 'wave' }, { do: 'shrug' }, ...moods.map(mood => ({ do: 'emote', mood, secs: 1 })),
    ],
  }))
  if ('error' in scene) throw new Error(scene.error)
  const stage = new Stage()
  stage.queue(scene)
  for (let t = 0; t < 40_000; t += 50) {
    stage.step(5_000_000 + t)
    stage.frame(80, 8)
  }
})

test('an interlude prompt asks to continue the story without new findings', async () => {
  const prompt = buildPrompt({ goal: 'fix the bug', log: ['read a.ts'], fresh: 0, previous: null, finished: false, interlude: { n: 2, quietSecs: 30, isLast: false } })
  expect(prompt).toContain('INTERLUDE 2')
  expect(prompt).toContain('30s')
  expect(prompt).not.toContain('Latest activity')
})

test('the stage reports how long it has stood idle', async () => {
  const scene = parseScene(JSON.stringify({ setting: 'meadow', props: [], beats: [{ do: 'wait', secs: 1 }] }))
  if ('error' in scene) throw new Error(scene.error)
  const stage = new Stage()
  stage.queue(scene)
  stage.step(10_000)
  expect(stage.idleMs).toBe(0)
  for (let t = 10_050; t <= 15_000; t += 50) stage.step(t) // the last action, a short rest, then idle
  expect(stage.idleMs).toBeGreaterThan(2500)
})

test('variety notes steer away from repeated settings and overused actions', async () => {
  const lib = (beats: object[]) => {
    const s = parseScene(JSON.stringify({ setting: 'library', props: [], beats }))
    if ('error' in s) throw new Error(s.error)
    return s
  }
  const recent = [lib([{ do: 'read' }, { do: 'say', text: 'a' }]), lib([{ do: 'read' }]), lib([{ do: 'read' }, { do: 'read' }])]
  const v = varietyNotes(recent, () => 0)
  expect(v.banned).toBe('library')
  expect(v.suggest).not.toBe('library')
  expect(v.overused[0]).toBe('read x4')
  const prompt = buildPrompt({ goal: 'x', log: ['read a.ts'], fresh: 1, previous: recent[2]!, finished: false, variety: v })
  expect(prompt).toContain(`do NOT use "library"`)
  expect(prompt).toContain('read x4')
})

test('once a turn has its setting, the prompt holds Sonnet to it', async () => {
  const v = varietyNotes([], () => 0, ['meadow', 'cave'], 'cave')
  const prompt = buildPrompt({ goal: 'x', log: ['read a.ts'], fresh: 1, previous: null, finished: false, variety: v })
  expect(prompt).toContain('fixed for this turn: "cave"')
  expect(prompt).not.toContain('suggested setting')
})

test('a pixel over half a text cell leaves the other half in the text background', async () => {
  const c = new Canvas(3, 2)
  c.text(1, 0, 'A', 0xffffff, 0x733e39) // a letter on a sign board
  c.set(1, 1, 0xd97757) // the top of a head, in the lower half of that cell
  const words = new Uint32Array(Uint8Array.from(atob(c.encode()), ch => ch.charCodeAt(0)).buffer)
  const [glyph, fg, bg] = [words[3], words[4], words[5]] // cell (1, 0)
  expect(glyph).toBe(0x2580) // upper half block: board on top, head below
  expect(fg).toBe(0x733e39)
  expect(bg).toBe(0xd97757)
})

test('actions are separated by a rest, and a new scene waits for the current one to finish', async () => {
  const first = parseScene(JSON.stringify({ setting: 'meadow', props: [], beats: [{ do: 'wait', secs: 1 }, { do: 'wait', secs: 1 }] }))
  const second = parseScene(JSON.stringify({ setting: 'cave', props: [], beats: [{ do: 'wait', secs: 1 }] }))
  if ('error' in first || 'error' in second) throw new Error('bad scene')
  const stage = new Stage(() => 0)
  stage.queue(first)
  stage.step(20_000) // first wait starts
  stage.queue(second) // arrives mid-scene
  for (let t = 20_050; t <= 21_200; t += 50) stage.step(t)
  expect(stage.idleMs).toBe(0) // resting after the first wait (0.3 s), not yet on the second
  for (let t = 21_250; t <= 22_400; t += 50) stage.step(t)
  const frameMid = stage.frame(40, 8)
  for (let t = 22_450; t <= 26_000; t += 50) stage.step(t)
  expect(frameMid.length).toBeGreaterThan(0)
})

test('ponder parses and plays', async () => {
  const scene = parseScene(JSON.stringify({ setting: 'night', props: [], beats: [{ do: 'ponder', secs: 2 }, { do: 'ponder', secs: 99 }] }))
  if ('error' in scene) throw new Error(scene.error)
  expect(scene.beats).toEqual([{ do: 'ponder', secs: 2 }, { do: 'ponder', secs: 6 }])
  const stage = new Stage()
  stage.queue(scene)
  for (let t = 0; t < 10_000; t += 50) {
    stage.step(30_000 + t)
    stage.frame(60, 10)
  }
})

test('after two idle minutes Claude dozes off, and a new scene wakes him', async () => {
  const scene = parseScene(JSON.stringify({ setting: 'meadow', props: [], beats: [{ do: 'wait', secs: 0.5 }] }))
  if ('error' in scene) throw new Error(scene.error)
  const stage = new Stage(() => 0)
  stage.queue(scene)
  for (let t = 0; t <= 125_000; t += 100) stage.step(50_000 + t)
  expect((stage as unknown as { mood(): string }).mood()).toBe('sleepy')
  stage.queue(scene)
  stage.step(175_100)
  expect((stage as unknown as { mood(): string }).mood()).toBe('neutral')
})

const sceneOf = (raw: object, world?: Parameters<typeof parseScene>[1]) => {
  const s = parseScene(JSON.stringify(raw), world)
  if ('error' in s) throw new Error(s.error)
  return s
}
const play = (stage: Stage, from: number, ms: number) => {
  for (let t = from; t <= from + ms; t += 50) {
    stage.step(t)
    stage.frame(80, 10)
  }
  return from + ms
}

test('transform lifts a prop, turns it into another kind, and sets it down', async () => {
  const stage = new Stage(() => 0)
  stage.frame(80, 10)
  stage.queue(sceneOf({
    setting: 'beach', props: [{ id: 's', kind: 'scroll', x: 60, label: 'notes' }],
    beats: [{ do: 'transform', at: 's', into: 'computer', label: 'npm test' }],
  }))
  play(stage, 100_000, 15_000)
  const w = stage.world()
  expect(w.props[0]!.kind).toBe('computer')
  expect(w.props[0]!.label).toBe('npm test')
})

test('a later scene of the turn keeps the world: same setting and props, squashed ones stay gone', async () => {
  const stage = new Stage(() => 0)
  stage.frame(80, 10)
  stage.queue(sceneOf({
    setting: 'forest', props: [{ id: 'b', kind: 'bug', x: 50 }, { id: 't', kind: 'tree', x: 85 }],
    beats: [{ do: 'squash', at: 'b' }],
  }))
  let t = play(stage, 200_000, 12_000)
  const world = stage.world()
  expect(world.gone).toEqual(['b'])
  // Sonnet tries a new setting and new props mid-turn: both are ignored
  const later = sceneOf({ setting: 'space', props: [{ id: 'x', kind: 'flag', x: 10 }], beats: [{ do: 'look', at: 't' }, { do: 'look', at: 'x' }] }, world)
  expect(later.setting).toBe('forest')
  expect(later.props.map(p => p.id)).toEqual(['t'])
  expect(later.beats.map(b => b.do)).toEqual(['look']) // the look at a prop that does not exist is dropped
  stage.queue(later)
  t = play(stage, t, 8_000)
  expect(stage.world().setting).toBe('forest')
  expect(stage.world().gone).toEqual(['b'])
})

test('a quick follow-up never pushes out the scene that sets up the new world', async () => {
  const stage = new Stage(() => 0)
  stage.frame(80, 10)
  stage.queue(sceneOf({ setting: 'meadow', props: [], beats: [{ do: 'wait', secs: 3 }] }))
  stage.step(300_000) // the old turn's scene is playing
  stage.queue(sceneOf({ setting: 'desert', props: [{ id: 'c', kind: 'cactus', x: 40 }], beats: [{ do: 'wait', secs: 1 }] }))
  const world = stage.world() // the follow-up is parsed against the queued desert, not the meadow
  expect(world.setting).toBe('desert')
  stage.queue(sceneOf({ props: [], beats: [{ do: 'look', at: 'c' }] }, world))
  play(stage, 300_050, 10_000)
  expect(stage.world().setting).toBe('desert')
  expect(stage.world().props.map(p => p.kind)).toEqual(['cactus'])
})

test('the request names the world after the first scene, and asks for one before it', async () => {
  const first = buildPrompt({ goal: 'x', log: ['read a.ts'], fresh: 1, previous: null, finished: false })
  expect(first).toContain('FIRST scene of a new turn')
  const later = buildPrompt({
    goal: 'x', log: ['read a.ts'], fresh: 1, previous: null, finished: false,
    world: { setting: 'cave', props: [{ id: 'l', kind: 'lamp', x: 30 }], gone: ['b'] },
  })
  expect(later).toContain('l = lamp at x=30')
  expect(later).toContain('gone: b')
  expect(later).toContain('do NOT send "props"')
})

test('plant_sign hammers in a labelled sign that later scenes see, and pull_sign removes it', async () => {
  const stage = new Stage(() => 0)
  stage.frame(90, 10)
  const scene = sceneOf({
    setting: 'meadow', props: [{ id: 't', kind: 'tree', x: 90 }],
    beats: [{ do: 'plant_sign', label: 'TTL in seconds', x: 50, id: 'ttl' }, { do: 'look', at: 'ttl', react: '!' }],
  })
  expect(scene.beats.map(b => b.do)).toEqual(['plant_sign', 'look']) // the look may name the sign planted just before
  stage.queue(scene)
  let t = play(stage, 400_000, 12_000)
  const world = stage.world()
  expect(world.props.find(p => p.id === 'ttl')).toMatchObject({ kind: 'sign', label: 'TTL in seconds' })
  const later = sceneOf({ beats: [{ do: 'pull_sign', at: 'ttl' }, { do: 'pull_sign', at: 't' }] }, world)
  expect(later.beats).toEqual([{ do: 'pull_sign', at: 'ttl' }]) // only signs can be pulled
  stage.queue(later)
  t = play(stage, t, 10_000)
  expect(stage.world().gone).toContain('ttl')
})

test('at most two planted signs stand at once, and repeated ids are made unique', async () => {
  const scene = sceneOf({
    setting: 'cave', props: [],
    beats: [1, 2, 3].map(n => ({ do: 'plant_sign', label: `note ${n}`, x: n * 30, id: 'n' })),
  })
  expect(scene.beats.map(b => ('id' in b ? b.id : ''))).toEqual(['n', 'n2', 'n3'])
  const stage = new Stage(() => 0)
  stage.frame(100, 10)
  stage.queue(scene)
  play(stage, 500_000, 30_000)
  expect(stage.world().props.filter(p => p.kind === 'sign').length).toBe(2)
})

test('a speech bubble never leaves fragments of a sign board around it', async () => {
  const stage = new Stage(() => 0.5)
  stage.frame(80, 10)
  stage.queue(sceneOf({
    setting: 'cave', props: [{ id: 's', kind: 'sign', x: 40, label: 'R_HUNT 340 vs 130' }],
    beats: [{ do: 'walk', to: 42 }, { do: 'say', text: 'Predators see more than twice as far as the boids do.' }],
  }))
  for (let t = 0; t <= 9_000; t += 50) {
    stage.step(2_000_000 + t)
    const bytes = Uint8Array.from(atob(stage.frame(80, 10)), ch => ch.charCodeAt(0))
    const cells = new Uint32Array(bytes.buffer)
    let corners = 0
    for (let i = 0; i < cells.length; i += 3) if (cells[i] === 0x256d) corners++ // '╭': a box's top-left corner
    // the sign's board and the bubble may each show, but never one cutting into the other
    expect(corners).toBeLessThanOrEqual(2)
    if (corners === 2) {
      const tops: number[] = []
      for (let i = 0; i < cells.length; i += 3) if (cells[i] === 0x256d) tops.push(i / 3)
      const [a, b] = tops.map(c => ({ row: Math.floor(c / 80), col: c % 80 }))
      expect(a!.row !== b!.row || Math.abs(a!.col - b!.col) > 20).toBe(true)
    }
  }
})

test('props never overlap: a crowded world is spread out, and planted signs find a free spot', async () => {
  type Spans = { span(p: object, col: number): [number, number]; col(x: number, id?: string): number }
  const spans = (stage: Stage) => {
    const s = stage as unknown as Spans
    return stage.world().props.map(p => s.span(p, s.col(p.x, p.id)))
  }
  const disjoint = (list: [number, number][]) =>
    list.every(([l, r], i) => list.every(([ol, or], j) => i === j || r + 2 <= ol || or + 2 <= l))
  const stage = new Stage(() => 0)
  stage.frame(100, 10)
  stage.queue(sceneOf({
    setting: 'beach',
    props: [
      { id: 'a', kind: 'sign', x: 40, label: 'drawBubble, line 749' },
      { id: 'b', kind: 'sign', x: 46, label: 'bubble' },
      { id: 'c', kind: 'scroll', x: 43, label: 'layout notes' },
    ],
    beats: [{ do: 'plant_sign', label: 'overlap fixed?', x: 44, id: 'n' }],
  }))
  stage.step(3_000_000)
  stage.frame(100, 10)
  expect(disjoint(spans(stage))).toBe(true)
  play(stage, 3_000_050, 15_000)
  expect(stage.world().props.length).toBe(4)
  expect(disjoint(spans(stage))).toBe(true)

  // a world with no room left: the sign is not squeezed in
  const full = new Stage(() => 0)
  full.frame(100, 10)
  full.queue(sceneOf({
    setting: 'beach',
    props: [
      { id: 'a', kind: 'sign', x: 40, label: 'drawBubble, line 749' },
      { id: 'b', kind: 'sign', x: 46, label: 'bubble' },
      { id: 'c', kind: 'scroll', x: 43, label: 'layout notes' },
      { id: 'd', kind: 'crate', x: 20 },
    ],
    beats: [{ do: 'plant_sign', label: 'overlap fixed?', x: 44, id: 'n' }],
  }))
  play(full, 4_000_000, 15_000)
  expect(full.world().props.map(p => p.id)).not.toContain('n')
  expect(disjoint(spans(full))).toBe(true)
})

test('director calls are tallied in tokens, and stored tallies are read back safely', async () => {
  const u = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 }
  const t = addUsage(addUsage(emptyTally(), u), u)
  expect(t).toEqual({ calls: 2, input: 2400, output: 600, cacheRead: 1600, cacheWrite: 0 })
  expect(asTally({ calls: 3, input: 'x' })).toEqual({ calls: 3, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  expect(today(new Date(2026, 9, 2))).toBe('2026-10-02')
  const text = formatStats('sonnet', t, t, '2026-10-02')
  expect(text).toContain('| this session | 2 | 2400 | 600 | 1600 | 0 |')
})

test('a helper walks in, acts out its tool calls, reports back to Claude, and vanishes', async () => {
  const stage = new Stage(() => 0.3)
  stage.frame(100, 10)
  stage.queue(sceneOf({ setting: 'meadow', props: [], beats: [{ do: 'walk', to: 20 }] }))
  let t = play(stage, 6_000_000, 2_000)
  stage.helperStart('call-1', 'explore the tests')
  expect(stage.helperCount).toBe(1)
  t = play(stage, t, 6_000) // walks in
  stage.helperActivity('agent-a', 'Read')
  t = play(stage, t, 1_000)
  stage.helperActivity('agent-a', 'Grep')
  t = play(stage, t, 2_000)
  stage.helperDone('call-1')
  t = play(stage, t, 15_000) // walks over, hops, poof
  expect(stage.helperCount).toBe(0)
})

test('at most three helpers, and a background helper leaves after a quiet spell', async () => {
  const stage = new Stage(() => 0.5)
  stage.frame(100, 10)
  for (const id of ['a', 'b', 'c', 'd']) stage.helperStart(id, id, true)
  expect(stage.helperCount).toBe(3)
  play(stage, 7_000_000, 90_000)
  expect(stage.helperCount).toBe(0)
})

test('with "show when idle" off, the band shows only while Claude works', { options: { showWhenIdle: false } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, 'the engine band') as RenderElement
  })
  const working = await $.ui.mount({ plugin: 'agent-comic', surface: 'terminal', component: 'AbovePrompt', props: band(true) })
  expect(await working.find({ key: 'stage' })).toBeDefined()
  await working.unmount()
  const idle = await $.ui.mount({ plugin: 'agent-comic', surface: 'terminal', component: 'AbovePrompt', props: band(false) })
  expect(await idle.find({ key: 'stage' })).toBeUndefined()
  await idle.unmount()
})

test('a subagent seen only through its tool calls still gets a small Claude', async () => {
  const stage = new Stage(() => 0.5)
  stage.frame(100, 10)
  stage.helperActivity('agent-x', 'Read')
  expect(stage.helperCount).toBe(1)
  stage.helperActivity('agent-x', 'Grep')
  expect(stage.helperCount).toBe(1)
})

test('a subagent stop sends its small Claude over to report, then it vanishes', async () => {
  const stage = new Stage(() => 0.5)
  stage.frame(100, 10)
  stage.helperActivity('agent-y', 'Read')
  expect(stage.helperCount).toBe(1)
  play(stage, 8_000_000, 3_000)
  stage.helperDoneByAgent('agent-y')
  play(stage, 8_003_050, 15_000)
  expect(stage.helperCount).toBe(0)
})

test('the hat comes with the world: parsed in the first scene, kept by later ones, named to Sonnet', async () => {
  const first = sceneOf({ setting: 'cave', hat: 'miner', props: [{ id: 'r', kind: 'rock', x: 50 }], beats: [{ do: 'dig' }] })
  expect(first.hat).toBe('miner')
  expect(sceneOf({ setting: 'cave', hat: 'crown', props: [], beats: [{ do: 'jump' }] }).hat).toBe('none')
  const stage = new Stage(() => 0)
  stage.frame(80, 10)
  stage.queue(first)
  const t = play(stage, 9_000_000, 3_000)
  const world = stage.world()
  expect(world.hat).toBe('miner')
  const later = sceneOf({ hat: 'wizard', beats: [{ do: 'look', at: 'r' }] }, world)
  stage.queue(later)
  play(stage, t, 8_000)
  expect(stage.world().hat).toBe('miner') // Sonnet cannot swap hats mid-turn
  const prompt = buildPrompt({ goal: 'x', log: ['a'], fresh: 1, previous: null, finished: false, world: stage.world() })
  expect(prompt).toContain('hat miner')
})

test('every hat draws in every pose without throwing', async () => {
  for (const hat of ['wizard', 'miner', 'straw', 'tophat', 'nightcap']) {
    const stage = new Stage(() => 0.5)
    stage.frame(80, 10)
    stage.queue(sceneOf({
      setting: 'meadow', hat, props: [{ id: 'k', kind: 'crate', x: 60 }],
      beats: [{ do: 'emote', mood: 'surprised', secs: 1 }, { do: 'carry', at: 'k' }, { do: 'drop' }, { do: 'jump' }, { do: 'look', at: 'k', react: '!' }],
    }))
    play(stage, 10_000_000, 15_000)
  }
})

const asking = (over: Partial<AskState> = {}): AskState => ({
  now: 100_000, pace: 'calm', fresh: 0, lastAsk: 0, lastActivity: 100_000, isTurnRunning: true, isWrapPending: false,
  isWorldless: false, interludes: 0, remainingMs: 0, untilFreeMs: 0, latencyMs: 7000, ...over,
})

test('the next scene is asked for as the stage is about to run dry, not while it still has plenty to play', async () => {
  expect(nextAsk(asking({ fresh: 2, remainingMs: 20_000, untilFreeMs: 20_000 }))).toBe(null)
  expect(nextAsk(asking({ fresh: 2, remainingMs: 8_000, untilFreeMs: 8_000 }))).toBe('scene')
  // news is timed to the scene's next pause, not to its end
  expect(nextAsk(asking({ fresh: 2, remainingMs: 20_000, untilFreeMs: 3_000 }))).toBe('scene')
  // never two requests within the pace's least gap
  expect(nextAsk(asking({ fresh: 2, remainingMs: 0, lastAsk: 95_000 }))).toBe(null)
  // nothing new: no scene, however empty the stage
  expect(nextAsk(asking({ remainingMs: 0 }))).toBe(null)
  // the turn's first scene sets up the world and goes at once, even behind a long scene
  expect(nextAsk(asking({ fresh: 1, remainingMs: 25_000, untilFreeMs: 25_000, isWorldless: true }))).toBe('scene')
  // a finished turn gets its wrap-up whatever is playing
  expect(nextAsk(asking({ isWrapPending: true, remainingMs: 25_000 }))).toBe('wrap')
})

test('an interlude is asked for ahead of time, once the turn has been quiet a while', async () => {
  const quiet = { lastActivity: 90_000, lastAsk: 90_000 }
  expect(nextAsk(asking({ ...quiet, remainingMs: 5_000 }))).toBe('interlude')
  // the current scene has a while to go: an interlude waits for its end, not for a pause
  expect(nextAsk(asking({ ...quiet, remainingMs: 15_000, untilFreeMs: 2_000 }))).toBe(null)
  expect(nextAsk(asking({ remainingMs: 0, lastActivity: 97_000 }))).toBe(null) // activity only just now
  expect(nextAsk(asking({ ...quiet, remainingMs: 0, interludes: 4 }))).toBe(null) // he has gone to sleep
  expect(nextAsk(asking({ ...quiet, remainingMs: 0, isTurnRunning: false }))).toBe(null) // between turns
})

test('the stage says about how long it has left to play, queued scenes included', async () => {
  const one = parseScene(JSON.stringify({ setting: 'meadow', props: [], beats: [{ do: 'wait', secs: 2 }, { do: 'wait', secs: 1 }] }))
  const two = parseScene(JSON.stringify({ setting: 'cave', props: [], beats: [{ do: 'wait', secs: 3 }] }))
  if ('error' in one || 'error' in two) throw new Error('bad scene')
  const stage = new Stage(() => 0.5)
  stage.frame(80, 8)
  expect(stage.remainingMs).toBe(0)
  stage.queue(one)
  // 2 s + 1 s of waiting, each followed by a 0.6 s rest
  expect(Math.abs(stage.remainingMs - 4200)).toBeLessThan(300)
  stage.step(10_000)
  for (let t = 10_050; t <= 11_000; t += 50) stage.step(t)
  expect(Math.abs(stage.remainingMs - 3200)).toBeLessThan(300)
  stage.queue({ ...two, continues: true })
  expect(Math.abs(stage.remainingMs - 6800)).toBeLessThan(400)
  for (let t = 11_050; t <= 20_000; t += 50) stage.step(t)
  expect(stage.remainingMs).toBe(0)
})

test('a walk counts toward the time left at the pace he walks', async () => {
  const walk = parseScene(JSON.stringify({ setting: 'meadow', props: [], beats: [{ do: 'walk', to: 100 }] }))
  if ('error' in walk) throw new Error('bad scene')
  const stage = new Stage(() => 0.5)
  stage.frame(100, 8)
  stage.queue(walk)
  // from column 4 across the 100-column strip at 9 columns a second, then a rest
  expect(stage.remainingMs).toBeGreaterThan(8000)
  expect(stage.remainingMs).toBeLessThan(12_000)
})

test('a tool cue shows over Claude at once and fades, and a failure stays over later cues', async () => {
  const stage = new Stage(() => 0.5)
  stage.step(50_000)
  const before = stage.frame(60, 8)
  stage.cue('read')
  stage.step(50_050)
  expect(stage.frame(60, 8)).not.toBe(before)
  stage.cue('fail')
  stage.cue('run') // the failure keeps its mark
  stage.step(50_100)
  const failing = stage.frame(60, 8)
  stage.cue('fail')
  stage.step(50_150)
  expect(stage.frame(60, 8)).toBe(failing)
  for (let t = 50_200; t <= 54_000; t += 50) stage.step(t)
  expect(stage.frame(60, 8)).toBe(before)
})

test('each played scene adds to the latency figures, and /comic-stats reads them out', async () => {
  let t = emptyTimings()
  t = addTiming(t, { kind: 'scene', activity: 1000, asked: 2000, answered: 9000, expectedLeftMs: 8000 }, 12_000)
  t = addTiming(t, { kind: 'interlude', asked: 20_000, answered: 26_000, expectedLeftMs: 5000 }, 26_000) // no activity of its own
  const { recent, ...sums } = t
  expect(sums).toEqual({ scenes: 2, staged: 1, waitMs: 1000, modelMs: 13_000, queueMs: 3000, totalMs: 11_000 })
  expect(recent.map(r => r.kind)).toEqual(['scene', 'interlude'])
  const text = formatTimings(t, 6500, 3)
  expect(text).toContain('| 1.0s | 6.5s | 1.5s | 11.0s |')
  expect(text).toContain('| scene | 1.0s | 7.0s | 3.0s | 11.0s | 8.0s / 10.0s |')
  expect(text).toContain('| interlude | – | 6.0s | 0.0s | – | 5.0s / 6.0s |')
  expect(text).toContain('1 more still queued or dropped')
  expect(formatTimings(emptyTimings(), 7000, 0)).toContain('no director scene')
})

const waits = (n: number, extra: object[] = []) =>
  parseScene(JSON.stringify({ setting: 'meadow', props: [{ id: 'c', kind: 'crate', x: 60 }], beats: [...Array.from({ length: n }, () => ({ do: 'wait', secs: 1 })), ...extra] }))

/** Steps the stage until `until`, returning when `scene` began to play (or null). */
function playUntil(stage: Stage, from: number, until: number, started: { at: number | null }) {
  for (let t = from; t <= until; t += 50) stage.step(t)
  return started.at
}

test('news ends the playing scene at its first pause after three beats', async () => {
  const long = waits(8)
  const news = waits(1)
  if ('error' in long || 'error' in news) throw new Error('bad scene')
  const stage = new Stage(() => 0.5)
  stage.frame(80, 8)
  const started = { at: null as number | null }
  stage.onPlay = s => { if (s === news || s.beats === news.beats) started.at ??= stage['now'] }
  stage.queue(long)
  stage.step(10_000)
  // the full scene runs about 13 s; it gives way after three beats (about 5 s)
  expect(stage.untilFreeMs).toBeLessThan(stage.remainingMs)
  expect(Math.abs(stage.untilFreeMs - 4800)).toBeLessThan(600)
  stage.queue({ ...news, continues: true, isNews: true })
  const at = playUntil(stage, 10_050, 20_000, started)
  expect(at).not.toBe(null)
  expect(at! - 10_000).toBeLessThan(6000)
})

test('a scene that is not news (an interlude) waits for the playing one to end', async () => {
  const long = waits(8)
  const filler = waits(1)
  if ('error' in long || 'error' in filler) throw new Error('bad scene')
  const stage = new Stage(() => 0.5)
  stage.frame(80, 8)
  const started = { at: null as number | null }
  stage.onPlay = s => { if (s.beats === filler.beats) started.at ??= stage['now'] }
  stage.queue(long)
  stage.step(10_000)
  stage.queue({ ...filler, continues: true })
  const at = playUntil(stage, 10_050, 30_000, started)
  expect(at! - 10_000).toBeGreaterThan(12_000)
})

test('news never cuts in while Claude has something in his hands', async () => {
  // three waits, then he lifts the crate, waits twice holding it, sets it down, and has two beats left
  const busy = waits(3, [{ do: 'carry', at: 'c' }, { do: 'wait', secs: 1 }, { do: 'wait', secs: 1 }, { do: 'drop' }, { do: 'wait', secs: 1 }, { do: 'wait', secs: 1 }])
  const news = waits(1)
  if ('error' in busy || 'error' in news) throw new Error('bad scene')
  const stage = new Stage(() => 0.5)
  const peek = stage as unknown as { carrying: string | null; index: number }
  stage.frame(80, 8)
  stage.queue(busy)
  let t = 10_000
  stage.step(t)
  while (peek.carrying === null && t < 40_000) stage.step((t += 50))
  expect(peek.carrying).toBe('c') // holding the crate, past the third beat
  const cuts: { isHolding: boolean; beatsPlayed: number }[] = []
  let played = 0 // beats of the busy scene begun, as of the step before
  stage.onPlay = () => cuts.push({ isHolding: peek.carrying !== null, beatsPlayed: played })
  stage.queue({ ...news, continues: true, isNews: true })
  for (; t <= 60_000; t += 50) {
    if (!cuts.length) played = peek.index
    stage.step(t)
  }
  // it waited for the drop (beat 7), then cut in before the scene's last two beats
  expect(cuts).toEqual([{ isHolding: false, beatsPlayed: 7 }])
})

test('text the host would refuse never reaches the canvas: emoji, marks and invisible characters', async () => {
  expect(cellText('✅ tests pass ⚡ café​ ❤️')).toBe('tests pass café')
  const c = new Canvas(30, 2)
  c.text(0, 0, '✅⚡é​️⭐ok', 0xffffff)
  const drawn = [...c.glyph.slice(0, 9)]
  expect(drawn).toEqual([0x3f, 0x3f, 0x65, 0x3f, 0x3f, 0x3f, 0x3f, 0x6f, 0x6b])
  const scene = parseScene(JSON.stringify({ setting: 'meadow', props: [], beats: [{ do: 'say', text: '✅ All 43 tests pass 🎉' }] }))
  if ('error' in scene) throw new Error(scene.error)
  expect(scene.beats[0]).toMatchObject({ do: 'say', text: 'All 43 tests pass' })
})

test('a box keeps its border tight whatever the width of its lines, and an empty one draws nothing', async () => {
  const c = new Canvas(12, 4)
  c.box(0, 0, ['\u{1F600}', 'ab'], 1, 2, 3)
  // row 1: │ ? space space │ — no hole between the borders
  const row = [...c.glyph.slice(12, 12 + 6)]
  expect(row.every(g => g !== 0)).toBe(true)
  expect(row[5]).toBe('│'.codePointAt(0)!)
  expect(() => new Canvas(12, 4).box(0, 0, [], 1, 2, 3)).not.toThrow()
})

// ---- the director loop, driven through the hooks with Sonnet stood in for ----

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const sceneIn = (setting: string) => ({ isAnswered: true, text: JSON.stringify({ setting, props: [], beats: [{ do: 'wait', secs: 1 }] }), usage: USAGE }) as ModelCompleteResult

/** A session with the engine stood in for; `answer` plays Sonnet, one call at a time, in order. */
async function directorSession($: Engine, on: On, answer: (prompt: string, n: number) => ModelCompleteResult | Promise<ModelCompleteResult>) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const asks: string[] = []
  const systems: (readonly { text: string; cache?: boolean }[] | undefined)[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('model.complete', async (_$, e) => {
    asks.push(String(e.prompt))
    systems.push(e.systemBlocks)
    return { value: await answer(String(e.prompt), asks.length) }
  })
  on('ui.log', async () => ({ value: undefined }))
  const tools: string[] = []
  on('tool.register', async (_$, e) => {
    tools.push(e.name)
    return { value: { tool: `mcp__agent-comic__${e.name}` } }
  })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const turn = (text: string, extra: object = {}) => $.prompt.submit({ text, ...extra } as Parameters<Engine['prompt']['submit']>[0])
  const done = (extra: object = {}) =>
    $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', ...extra } as Parameters<Engine['turn']['complete']>[0])
  return { clock, asks, systems, tools, turn, done }
}

test('an answer for an old turn never sets up the new one, and does not hold it up', async ($, on) => {
  let release: (r: ModelCompleteResult) => void = () => undefined
  const s = await directorSession($, on, (_p, n) => (n === 1 ? new Promise(r => { release = r }) : sceneIn('beach')))
  await s.turn('first job')
  await s.clock.advance(1000)
  expect(s.asks.length).toBe(1) // the first turn's world, still on its way
  await s.turn('second job')
  await s.clock.advance(1000)
  expect(s.asks.length).toBe(2) // the new turn asks at once, not after the old answer
  expect(s.asks[1]).toContain('second job')
  release(sceneIn('cave')) // the old answer lands late
  await s.clock.advance(1000)
  await s.done()
  await s.clock.advance(1000)
  const wrap = s.asks[s.asks.length - 1]!
  expect(wrap).toContain('setting beach')
  expect(wrap).not.toContain('setting cave')
})

test('a subagent finishing is no wrap-up, and a turn stopped with Esc gets none either', async ($, on) => {
  const s = await directorSession($, on, () => sceneIn('forest'))
  await s.turn('look into it')
  await s.clock.advance(1000)
  expect(s.asks.length).toBe(1)
  await s.done({ agentId: 'helper-1' })
  await s.clock.advance(2000)
  expect(s.asks.length).toBe(1)
  await s.done({ reason: 'aborted', isAborted: true })
  await s.clock.advance(2000)
  expect(s.asks.length).toBe(1)
})

test('a prompt typed over the running turn carries the story on in the same world', async ($, on) => {
  const s = await directorSession($, on, () => sceneIn('library'))
  await s.turn('write the docs')
  await s.clock.advance(1000)
  await s.turn('also the changelog', { turnId: 't' })
  await s.done()
  await s.clock.advance(1000)
  const wrap = s.asks[s.asks.length - 1]!
  expect(wrap).toContain('setting library') // the world was not reset
  expect(wrap).toContain('the person added: also the changelog')
  expect(wrap).toContain('write the docs') // the goal stays the first prompt's
})

test('a failed wrap-up falls back to a canned one, and the model rests a while', async ($, on) => {
  const s = await directorSession($, on, (_p, n) =>
    n === 2 ? ({ isAnswered: false, reason: 'aborted' } as unknown as ModelCompleteResult) : sceneIn('night'))
  await s.turn('ship it')
  await s.clock.advance(1000)
  await s.done()
  await s.clock.advance(1000)
  expect(s.asks.length).toBe(2) // the wrap, which fails: a canned wrap-up plays instead
  await s.turn('one more thing')
  await s.clock.advance(1000)
  expect(s.asks.length).toBe(3) // a new turn is a fresh start for the model
})

test('with the director off, a whole turn plays without a single model call', { options: { director: 'off' } }, async ($, on) => {
  const s = await directorSession($, on, () => sceneIn('meadow'))
  expect(s.tools).toEqual(['hub_add'])
  await s.turn('refactor the parser')
  await s.clock.advance(3000)
  await s.done()
  await s.clock.advance(3000)
  expect(s.asks.length).toBe(0)
})

test('a new turn and its end are asked about at once, with the fixed instructions cached', async ($, on) => {
  const s = await directorSession($, on, () => sceneIn('desert'))
  await s.turn('tidy up')
  await s.clock.settle() // no tick of the clock: the ask is not left for the next second
  expect(s.asks.length).toBe(1)
  expect(s.systems[0]?.[0]?.cache).toBe(true)
  await s.done()
  await s.clock.settle()
  expect(s.asks.length).toBe(2)
  expect(s.asks[1]).toContain('FINISHED')
})

// ---- the hub, the door, and what the stage tells the person ----

/** A frame's cells back as text rows and colours, to look at what the band shows. */
function cells(encoded: string, columns: number) {
  const bin = atob(encoded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const u = new Uint32Array(bytes.buffer)
  const rows: { text: string; fg: number[]; bg: number[] }[] = []
  for (let o = 0; o < u.length; o += columns * 3) {
    let text = ''
    const fg: number[] = []
    const bg: number[] = []
    for (let c = 0; c < columns; c++) {
      text += String.fromCodePoint(u[o + c * 3]!)
      fg.push(u[o + c * 3 + 1]!)
      bg.push(u[o + c * 3 + 2]!)
    }
    rows.push({ text, fg, bg })
  }
  return rows
}
const shown = (stage: Stage, columns = 90, rows = 10) => cells(stage.frame(columns, rows), columns)
const allText = (stage: Stage) => shown(stage).map(r => r.text).join('\n')

test('the session opens at home; a new turn walks him through the door into the world of the turn', async () => {
  const st = new Stage(() => 0.5)
  st.frame(90, 10)
  st.setHome([{ kind: 'trophy', label: 'bug slain', at: 1 }])
  st.startHome()
  expect(st.home).toBe(true)
  expect(st.leaveHome()).toBe(true)
  st.queue(sceneOf({ setting: 'cave', props: [], beats: [{ do: 'wait', secs: 1 }] }))
  let t = 1_000_000
  for (const end = t + 1500; t < end; t += 50) st.step(t)
  expect(st.home).toBe(true) // still on his way to the door: the world of the turn waits for him
  for (const end = t + 15_000; t < end; t += 50) {
    st.step(t)
    st.frame(90, 10)
  }
  expect(st.home).toBe(false)
  expect(st.world().setting).toBe('cave')
  // a long idle between turns, and he goes home again
  for (const end = t + 125_000; t < end; t += 200) st.step(t)
  expect(st.wantsHome).toBe(true)
  st.goHome()
  expect(st.home).toBe(true)
})

test('at home a new keepsake pops in with its label up', async () => {
  const st = new Stage(() => 0.5)
  st.frame(90, 10)
  st.setHome([])
  st.startHome()
  st.step(1_000_000)
  st.addHomeItem({ kind: 'gem', label: 'rare find', at: 2 })
  st.step(1_000_050)
  expect(allText(st)).toContain('rare find')
})

test('needing the person: he turns to them with a call out, and the scene waits for the answer', async () => {
  const st = new Stage(() => 0.5)
  st.frame(90, 10)
  st.queue(sceneOf({ setting: 'meadow', props: [], beats: [{ do: 'wait', secs: 4 }, { do: 'wave' }] }))
  let t = 1_000_000
  for (const end = t + 1000; t < end; t += 50) st.step(t)
  const before = st.remainingMs
  st.attention = 'permission'
  for (const end = t + 20_000; t < end; t += 50) st.step(t)
  expect(allText(st)).toContain('Needs your OK')
  st.attention = null
  st.step(t)
  expect(Math.abs(st.remainingMs - before)).toBeLessThan(200) // carried on where it was, not 20 s on
  expect(allText(st)).not.toContain('Needs your OK')
})

test('the task trail lights up along the ground as tasks are done', async () => {
  const st = new Stage(() => 0.5)
  st.frame(90, 10)
  st.step(1_000_000)
  const amber = 0xfeae34
  st.progress = { done: 1, total: 4 }
  const quarter = shown(st)[9]!.bg.filter(c => c === amber).length
  st.progress = { done: 3, total: 4 }
  const most = shown(st)[9]!.bg.filter(c => c === amber).length
  expect(quarter).toBeGreaterThan(10)
  expect(most).toBeGreaterThan(quarter * 2)
})

test('the sky keeps the hour and the weather, out of doors only', async () => {
  const st = new Stage(() => 0.5)
  st.frame(90, 10)
  st.queue(sceneOf({ setting: 'meadow', props: [], beats: [{ do: 'wait', secs: 1 }] }))
  st.step(1_000_000)
  const sky = (s: Stage) => shown(s).slice(0, 4).flatMap(r => [...r.fg, ...r.bg])
  const sun = 0xfee761
  const rain = 0x0099db
  st.ambience = { hour: 13, weather: 'clear' }
  expect(sky(st)).toContain(sun)
  st.ambience = { hour: 23, weather: 'clear' }
  expect(sky(st)).not.toContain(sun) // a moon instead
  st.ambience = { hour: 13, weather: 'rain' }
  let hasRain = false
  for (let t = 1_000_000; t < 1_004_000 && !hasRain; t += 100) {
    st.step(t)
    hasRain = shown(st).some(r => r.fg.includes(rain) || r.bg.includes(rain))
  }
  expect(hasRain).toBe(true)
  const cave = new Stage(() => 0.5)
  cave.frame(90, 10)
  cave.queue(sceneOf({ setting: 'cave', props: [], beats: [{ do: 'wait', secs: 1 }] }))
  cave.step(1_000_000)
  cave.ambience = { hour: 13, weather: 'rain' }
  const caveRain = [0, 300, 600, 900].some(dt => {
    cave.step(1_000_000 + dt)
    return shown(cave).slice(0, 3).some(r => r.fg.includes(rain) || r.bg.includes(rain))
  })
  expect(caveRain).toBe(false)
})

test('a commit plants a little flag, a push lets a balloon go', async () => {
  const st = new Stage(() => 0.5)
  st.frame(90, 10)
  st.queue(sceneOf({ setting: 'cave', props: [], beats: [{ do: 'walk', to: 50 }] }))
  play(st, 1_000_000, 8000)
  const gold = (s: Stage) => shown(s).flatMap(r => [...r.fg, ...r.bg]).filter(c => c === 0xfee761).length
  const before = gold(st)
  st.gitMoment('commit')
  expect(gold(st)).toBeGreaterThan(before)
  expect(() => {
    st.gitMoment('push')
    play(st, 1_008_000, 5000)
  }).not.toThrow()
})

test('Claude keeps a milestone in the hub with the comic tool, a couple per session at most', async ($, on) => {
  await directorSession($, on, () => sceneIn('meadow'))
  const call = async (input: object) => {
    const r = await $.tool.call({ tool: 'mcp__agent-comic__hub_add', ...input } as unknown as Parameters<Engine['tool']['call']>[0])
    return String((r as { result?: unknown }).result)
  }
  expect(await call({ kind: 'trophy', label: 'auth bug slain ✅' })).toContain('"auth bug slain"')
  expect(await call({ kind: 'spaceship', label: 'to the moon' })).toContain('Not added')
  await call({ kind: 'gem', label: 'second' })
  expect(await call({ kind: 'plant', label: 'third' })).toContain('already')
  const list = await $.command.run({ command: 'comic-hub', args: '' } as unknown as Parameters<Engine['command']['run']>[0])
  expect(JSON.stringify(list)).toContain('trophy: auth bug slain')
})

const bandText = async ($: Engine) => {
  const mounted = await $.ui.mount({ plugin: 'agent-comic', surface: 'terminal', component: 'AbovePrompt', props: band(true) })
  const raster = (await mounted.find({ key: 'stage' })) as unknown as { props: { cells: string; columns: number } }
  const text = cells(raster.props.cells, raster.props.columns).map(r => r.text).join('\n')
  await mounted.unmount()
  return text
}
const permissionRequest = ($: Engine) =>
  $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } } as unknown as Parameters<Engine['classic']['PermissionRequest']>[0])

test('a permission dialog puts the call out on the band, and the tool running takes it down', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, 'engine') as RenderElement
  })
  on('classic.PermissionRequest', async () => ({}))
  await directorSession($, on, () => sceneIn('meadow'))
  await permissionRequest($)
  expect(await bandText($)).toContain('Needs your OK')
  // allowed: the tool runs, and its progress row comes up under it
  const progress = await $.ui.mount({
    plugin: 'agent-comic', surface: 'terminal', component: 'ToolProgress',
    props: { tool_use_id: 'toolu_1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
  })
  await progress.unmount()
  expect(await bandText($)).not.toContain('Needs your OK')
})

test('a permission request a hook or the auto-mode classifier settles puts no call out', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, 'engine') as RenderElement
  })
  on('classic.PermissionRequest', async () => ({ decision: { behavior: 'allow' } }))
  await directorSession($, on, () => sceneIn('meadow'))
  await permissionRequest($)
  expect(await bandText($)).not.toContain('Needs your OK')
})

test('at home every keepsake keeps its title up, and long neighbouring titles never run together', async () => {
  const st = new Stage(() => 0.5)
  st.frame(90, 10)
  st.setHome([
    { kind: 'trophy', label: 'auth bug slain', at: 1 }, { kind: 'statue', label: 'hub world built', at: 2 },
    { kind: 'gem', label: 'rare find', at: 3 },
  ])
  st.startHome()
  st.step(1_000_000)
  const text = allText(st)
  for (const title of ['auth bug slain', 'hub world built', 'rare find']) expect(text).toContain(title)
})

test('a new turn has him sprint for the door, awake or woken from a nap', async () => {
  const leaveFrom = (isAsleep: boolean) => {
    const st = new Stage(() => 0.5)
    st.frame(90, 10)
    st.setHome([])
    let t = 1_000_000
    if (isAsleep) {
      st.queue(sceneOf({ setting: 'cave', props: [], beats: [{ do: 'wait', secs: 0.3 }] }))
      st.step(t)
      st.goHome() // back home after a long idle: he naps 15 s later
      for (const end = t + 17_000; t < end; t += 100) st.step(t)
    } else {
      st.startHome()
      st.step(t)
    }
    ;(st as unknown as { x: number }).x = 4 // both start from the far side of the hub
    st.leaveHome()
    st.queue(sceneOf({ setting: 'forest', props: [], beats: [{ do: 'wait', secs: 1 }] }))
    const start = t
    while (st.home && t < start + 30_000) st.step((t += 50))
    return t - start
  }
  // about 60 columns to the door: a calm walk (9 a second) would take near 7 s, a sprint under 3
  const awake = leaveFrom(false)
  const woken = leaveFrom(true)
  expect(awake).toBeLessThan(4500)
  expect(woken).toBeLessThan(awake + 1000) // the start up costs well under a second
})

test('a pat on the heart beside the band: he lights up, and a kind word lands in the chat', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, 'engine') as RenderElement
  })
  const session = mock.session(on)
  await directorSession($, on, () => sceneIn('meadow'))
  const mounted = await $.ui.mount({ plugin: 'agent-comic', surface: 'terminal', component: 'AbovePrompt', props: band(true) })
  expect(await mounted.find({ key: 'pet' })).toBeDefined()
  await mounted.press({ key: 'pet' })
  await mounted.unmount()
  const notes = session.appended().filter(r => r.message.type === 'system')
  expect(notes.length).toBe(1)
  expect(JSON.stringify(notes[0]!.message.content)).toContain('♥')
})

test('the hub keeps six keepsakes: a seventh retires the oldest', async () => {
  let items: HubItem[] = []
  for (let n = 1; n <= 6; n++) items = addHubItem(items, { kind: 'gem', label: `gem ${n}`, at: n }).items
  const added = addHubItem(items, { kind: 'statue', label: 'seventh', at: 7 })
  expect(added.items.length).toBe(6)
  expect(added.retired?.label).toBe('gem 1')
  expect(added.items[5]!.label).toBe('seventh')
})

test('at home he keeps himself busy at random, room to room: garden, keepsakes, the film, a rest', async () => {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const st = new Stage(rand)
  st.frame(100, 10)
  st.setHome([{ kind: 'trophy', label: 'won', at: 1 }])
  st.startHome()
  const seen = new Set<string>()
  for (let t = 1_000_000; t < 1_000_000 + 20 * 60_000; t += 100) {
    st.step(t)
    if (t % 1000 === 0) st.frame(100, 10)
    const doing = st.homeDoing
    if (doing && !doing.endsWith(':walking') && !doing.endsWith(':idle')) seen.add(doing)
  }
  for (const doing of ['garden:tend', 'hall:admire', 'den:movie', 'den:rest']) expect(seen.has(doing)).toBe(true)
})

test('whatever he is doing at home, a new turn has him drop it and sprint for the door', async () => {
  for (const pastime of ['tend', 'movie', 'rest', 'admire'] as const) {
    const st = new Stage(() => 0.5)
    st.frame(100, 10)
    st.setHome([{ kind: 'gem', label: 'x', at: 1 }])
    st.startHome()
    ;(st as unknown as { nextPastime: string }).nextPastime = pastime
    let t = 1_000_000
    // let him get there and settle in
    while (!(st.homeDoing ?? '').endsWith(pastime) && t < 1_060_000) st.step((t += 100))
    for (const end = t + 4000; t < end; t += 100) st.step(t)
    expect(st.homeDoing?.endsWith(pastime)).toBe(true)
    st.leaveHome()
    st.queue(sceneOf({ setting: 'forest', props: [], beats: [{ do: 'wait', secs: 1 }] }))
    const start = t
    while (st.home && t < start + 20_000) st.step((t += 50))
    expect(t - start).toBeLessThan(6000)
  }
})
