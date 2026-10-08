// Plays every mood and every action as its own short scene through the real Stage
// and writes all frames (every 50 ms, as live) for export.py to turn into GIFs.
//   bun dev/export.ts <out dir> && python dev/export.py <out dir>

import { mkdirSync, writeFileSync } from 'node:fs'

import { parseScene } from '../hooks/scene'
import type { Scene } from '../hooks/scene'
import { MOOD_SHOWS } from '../hooks/demo'
import { Stage } from '../hooks/stage'
import type { HubItem } from '../hooks/hub'

const out = process.argv[2] ?? 'dev/out/export'

function seeded(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const scene = (raw: unknown): Scene => {
  const s = parseScene(JSON.stringify(raw))
  if ('error' in s) throw new Error(s.error)
  return s
}

type Clip = { kind: 'emotion' | 'action'; shows: string; scene: Scene; ms: number; columns: number }
const clips: Record<string, Clip> = {}

for (const [mood, shows] of Object.entries(MOOD_SHOWS)) {
  clips[mood] = {
    kind: 'emotion', shows, ms: 4000, columns: 40,
    scene: scene({ setting: 'meadow', props: [], beats: [{ do: 'walk', to: 50 }, { do: 'emote', mood, secs: 5 }] }),
  }
}

const action = (name: string, shows: string, ms: number, raw: object, columns = 60) => {
  clips[name] = { kind: 'action', shows, ms, columns, scene: scene({ setting: 'meadow', ...raw }) }
}
action('walk', 'four-frame walk, light stays top-left both ways', 4500, { props: [], beats: [{ do: 'walk', to: 90 }, { do: 'walk', to: 10 }] })
action('run', 'fast legs, arms up, dust trail', 2500, { props: [], beats: [{ do: 'run', to: 95 }, { do: 'run', to: 5 }] })
action('read', 'open book held up, eyes down, a page turns', 3000, { props: [], beats: [{ do: 'walk', to: 40 }, { do: 'read', secs: 4 }] }, 40)
action('type', 'walks to the computer, arms alternate, cursor races', 4500, { props: [{ id: 'c', kind: 'computer', x: 70 }], beats: [{ do: 'type', at: 'c', secs: 3 }] })
action('carry-drop', 'lifts the crate overhead, carries it, sets it down', 5000, { props: [{ id: 'k', kind: 'crate', x: 30 }], beats: [{ do: 'carry', at: 'k' }, { do: 'walk', to: 85 }, { do: 'drop' }, { do: 'walk', to: 60 }] })
action('look', 'walks to a prop, faces it, eyes shift, "!"', 3500, { props: [{ id: 's', kind: 'sign', x: 60, label: 'README.md' }], beats: [{ do: 'look', at: 's', react: '!' }] })
action('squash', 'jumps on the bug, it vanishes in a puff', 3500, { props: [{ id: 'b', kind: 'bug', x: 60 }], beats: [{ do: 'squash', at: 'b' }, { do: 'wait', secs: 1 }] })
action('dig', 'shovel strokes, flings dirt over his shoulder', 2500, { props: [], beats: [{ do: 'walk', to: 50 }, { do: 'dig', secs: 3 }] }, 40)
action('jump', 'a single hop, legs tucked', 1500, { props: [], beats: [{ do: 'walk', to: 50 }, { do: 'jump' }, { do: 'wait', secs: 0.3 }, { do: 'jump' }] }, 40)
action('wave', 'one arm up and down, happy eyes', 2000, { props: [], beats: [{ do: 'walk', to: 50 }, { do: 'wave' }] }, 40)
action('shrug', 'both arms up, squinting', 1800, { props: [], beats: [{ do: 'walk', to: 50 }, { do: 'shrug' }] }, 40)
action('dance', 'hops, turns, swaps arms, sparkles', 3000, { props: [], beats: [{ do: 'walk', to: 50 }, { do: 'dance', secs: 3 }] }, 40)
action('celebrate', 'arms up, hops, sparkles', 1800, { props: [], beats: [{ do: 'walk', to: 50 }, { do: 'celebrate' }] }, 40)
action('ponder', 'stands, hand to chin, "..." bubble, looks one way then the other', 4000, { props: [], beats: [{ do: 'walk', to: 50 }, { do: 'ponder', secs: 4 }] }, 40)
action('calm-carry', 'the calmer pacing: pick up, rest, ponder, put down, rest, look', 12000, { props: [{ id: 'k', kind: 'crate', x: 25 }, { id: 's', kind: 'sign', x: 75, label: 'session.ts' }], beats: [{ do: 'carry', at: 'k' }, { do: 'ponder', secs: 2.5 }, { do: 'walk', to: 55 }, { do: 'drop' }, { do: 'look', at: 's', react: '?' }] })
action('transform', 'lifts the scroll, a puff of magic smoke, it is a computer now, sets it down', 7000, { props: [{ id: 's', kind: 'scroll', x: 55, label: 'notes' }], beats: [{ do: 'transform', at: 's', into: 'computer', label: 'npm test' }, { do: 'look', at: 's', react: '!' }] })
action('plant-sign', 'hammers a sign in: the post rises blow by blow, the text types itself in', 5500, { props: [], beats: [{ do: 'plant_sign', label: 'TTL in seconds?', x: 55, id: 'ttl' }] })
action('pull-sign', 'tugs a sign loose, it rises out of the ground and vanishes in a puff', 5500, { props: [{ id: 's', kind: 'sign', x: 55, label: 'TODO: rate limit' }], beats: [{ do: 'pull_sign', at: 's' }] })
action('hat-wizard', 'wizard hat: library, night, space, deep reading', 4000, { setting: 'library', hat: 'wizard', props: [], beats: [{ do: 'walk', to: 50 }, { do: 'jump' }, { do: 'emote', mood: 'happy', secs: 2 }] }, 40)
action('hat-miner', 'miner helmet: cave, digging, searching', 4000, { setting: 'cave', hat: 'miner', props: [], beats: [{ do: 'walk', to: 50 }, { do: 'jump' }, { do: 'emote', mood: 'happy', secs: 2 }] }, 40)
action('hat-straw', 'straw hat: beach, desert, meadow', 4000, { setting: 'beach', hat: 'straw', props: [], beats: [{ do: 'walk', to: 50 }, { do: 'jump' }, { do: 'emote', mood: 'happy', secs: 2 }] }, 40)
action('hat-tophat', 'top hat: a proud or festive turn', 4000, { setting: 'meadow', hat: 'tophat', props: [], beats: [{ do: 'walk', to: 50 }, { do: 'jump' }, { do: 'emote', mood: 'happy', secs: 2 }] }, 40)
action('hat-nightcap', 'nightcap: night, long waits, and dozing between turns', 4000, { setting: 'night', hat: 'nightcap', props: [], beats: [{ do: 'walk', to: 50 }, { do: 'jump' }, { do: 'emote', mood: 'happy', secs: 2 }] }, 40)
action('say', 'speech bubble', 3500, { props: [], beats: [{ do: 'walk', to: 15 }, { do: 'say', text: 'Found it: the fit keeps re-reading its whole history.', secs: 4 }] })
action('think', 'thought bubble', 3000, { props: [], beats: [{ do: 'walk', to: 15 }, { do: 'think', text: 'Hmm, is that a race condition?', secs: 4 }] })

// the stage's own features, driven as the hooks drive them: each a setup and a few timed calls
type Feature = { shows: string; ms: number; columns: number; setup: (s: Stage) => void; at?: [number, (s: Stage) => void][] }
const KEEPSAKES: HubItem[] = [
  { kind: 'trophy', label: 'auth bug slain', at: 1 }, { kind: 'plant', label: 'tests green', at: 2 },
  { kind: 'banner', label: 'v2 shipped', at: 3 }, { kind: 'gem', label: 'rare find', at: 4 },
  { kind: 'lantern', label: 'aha', at: 5 },
]
const world = scene({
  setting: 'meadow', props: [{ id: 'c', kind: 'computer', x: 55 }, { id: 't', kind: 'tree', x: 85 }],
  beats: [{ do: 'walk', to: 30 }, { do: 'type', at: 'c', secs: 3 }, { do: 'wait', secs: 2 }],
})
const working = scene({ setting: 'meadow', props: [{ id: 'c', kind: 'computer', x: 60 }], beats: [{ do: 'walk', to: 30 }, { do: 'type', at: 'c', secs: 6 }] })
const features: Record<string, Feature> = {
  'hub-start': { shows: 'the session opens at home: keepsakes from earlier sessions, labels as he strolls by', ms: 9000, columns: 90,
    setup: s => { s.setHome(KEEPSAKES); s.startHome() } },
  'hub-new-keepsake': { shows: 'Claude adds a keepsake with the hub tool: it pops in, labelled', ms: 4000, columns: 90,
    setup: s => { s.setHome(KEEPSAKES.slice(0, 3)); s.startHome() },
    at: [[800, s => s.addHomeItem({ kind: 'medal', label: 'parser rewrite', at: 9 })]] },
  'door-out': { shows: 'a new turn: he sprints to the door, goes through, and steps into the world of the turn', ms: 11000, columns: 90,
    setup: s => { s.setHome(KEEPSAKES); s.startHome() },
    at: [[600, s => { s.leaveHome(); s.queue(world) }]] },
  'door-home': { shows: 'a long idle between turns: back home through the door, and a nap soon after', ms: 19000, columns: 90,
    setup: s => { s.setHome(KEEPSAKES); s.queue(world) },
    at: [[1500, s => s.goHome()]] },
  'door-sprint': { shows: 'a new turn while he naps at home: he starts awake and sprints for the door', ms: 6000, columns: 90,
    setup: s => {
      // home 30 s before the clip starts, asleep by then; he dozed off on the far side
      s.setHome(KEEPSAKES)
      s.step(970_000)
      s.goHome()
      for (let t = 970_000; t < 1_000_000; t += 100) s.step(t)
      ;(s as unknown as { x: number }).x = 4
    },
    at: [[800, s => { s.leaveHome(); s.queue(world) }]] },
  'needs-you': { shows: 'a permission prompt or a question: he stops, turns to you and waves', ms: 6000, columns: 70,
    setup: s => s.queue(working),
    at: [[1500, s => { s.attention = 'permission' }], [4500, s => { s.attention = null }]] },
  'progress': { shows: 'the task list as a trail along the ground, the flag gold once all are done', ms: 6000, columns: 70,
    setup: s => { s.queue(working); s.progress = { done: 0, total: 4 } },
    at: [[1000, s => { s.progress = { done: 1, total: 4 } }], [2500, s => { s.progress = { done: 3, total: 4 } }], [4000, s => { s.progress = { done: 4, total: 4 } }]] },
  'git': { shows: 'git commit plants a little flag; git push lets a balloon go', ms: 6000, columns: 70,
    setup: s => s.queue(scene({ setting: 'beach', props: [], beats: [{ do: 'walk', to: 45 }, { do: 'wait', secs: 4 }] })),
    at: [[1500, s => s.gitMoment('commit')], [3000, s => s.gitMoment('push')]] },
  'weather-rain': { shows: 'several failures lately: rain clouds drift over (outdoor settings only)', ms: 4000, columns: 70,
    setup: s => { s.queue(working); s.ambience = { hour: 13, weather: 'rain' } } },
  'weather-cloudy': { shows: 'a failure lately: a cloud drifts over', ms: 4000, columns: 70,
    setup: s => { s.queue(working); s.ambience = { hour: 13, weather: 'cloudy' } } },
  'night': { shows: 'the local hour: after 21:00 a moon instead of the sun', ms: 3000, columns: 70,
    setup: s => { s.queue(working); s.ambience = { hour: 23, weather: 'clear' } } },
  'dusk': { shows: 'the local hour: at dawn and dusk the sun sits low', ms: 3000, columns: 70,
    setup: s => { s.queue(working); s.ambience = { hour: 19, weather: 'clear' } } },
}

const ROWS = 10
const result: Record<string, { kind: string; shows: string; columns: number; rows: number; frames: string[]; x: number[] }> = {}
for (const [name, f] of Object.entries(features)) {
  const stage = new Stage(seeded(11))
  stage.frame(f.columns, ROWS)
  f.setup(stage)
  const frames: string[] = []
  const x: number[] = []
  for (let t = 0; t <= f.ms; t += 50) {
    for (const [when, act] of f.at ?? []) if (when === t) act(stage)
    stage.step(1_000_000 + t)
    frames.push(stage.frame(f.columns, ROWS))
    x.push(stage.figureColumn)
  }
  result[name] = { kind: 'feature', shows: f.shows, columns: f.columns, rows: ROWS, frames, x }
}
for (const [name, clip] of Object.entries(clips)) {
  const stage = new Stage(seeded(11))
  stage.frame(clip.columns, ROWS) // size the stage first, so walk targets are in this clip's columns
  stage.queue(clip.scene)
  // let the opening walk-in finish off camera: record from when the clip's own beat starts
  let t = 0
  const settle = clip.kind === 'emotion' || clip.columns === 40 ? 1500 : 0
  for (; t < settle; t += 50) stage.step(1_000_000 + t)
  const frames: string[] = []
  const x: number[] = []
  for (let k = 0; k <= clip.ms; k += 50, t += 50) {
    stage.step(1_000_000 + t)
    frames.push(stage.frame(clip.columns, ROWS))
    x.push(stage.figureColumn)
  }
  result[name] = { kind: clip.kind, shows: clip.shows, columns: clip.columns, rows: ROWS, frames, x }
}

mkdirSync(out, { recursive: true })
writeFileSync(`${out}/frames.json`, JSON.stringify(result))
console.log(`${Object.keys(result).length} clips -> ${out}/frames.json`)
