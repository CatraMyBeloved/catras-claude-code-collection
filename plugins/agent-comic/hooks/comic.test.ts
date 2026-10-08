import { expect, test } from 'claude-code/testing'
import type { RenderElement, RenderPropsOf } from 'claude-code'

import { Canvas } from './canvas'
import { buildPrompt, describeCall, varietyNotes } from './director'
import { addTiming, emptyTimings, formatTimings, nextAsk } from './pacing'
import type { AskState } from './pacing'
import { clip, parseScene } from './scene'
import { Stage, wrap } from './stage'
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
