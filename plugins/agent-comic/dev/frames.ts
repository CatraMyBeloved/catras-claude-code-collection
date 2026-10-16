// Plays scenarios through the real Stage and writes their frames to dev/out/frames.json, for sheet.py
// (a contact sheet per scenario) and gallery.py (close-ups that follow the figure). Run from the mod folder:
//   bun dev/frames.ts                 every scenario
//   bun dev/frames.ts crowd signtalk  just these, kept beside the others already in frames.json
//   python dev/sheet.py               then the PNGs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { Canvas } from '../hooks/canvas'
import { TINTS, claude } from '../hooks/sprites'
import type { Face } from '../hooks/sprites'
import { Stage } from '../hooks/stage'
import { scene, seeded } from './lib'

const OUT = 'dev/out/frames.json'

/**
 * A scenario: a stage set up and played for `ms`, its frames kept every `every` ms (or at `times`);
 * `at` acts on the stage at a given time.
 */
type Scenario = {
  ms: number
  setup: (s: Stage) => void
  columns?: number
  rows?: number
  every?: number
  times?: number[]
  rand?: () => number
  at?: Record<number, (s: Stage) => void>
}
type Frames = { columns: number; rows: number; frames: Record<string, string>; x: Record<string, number> }

const played = (raw: object, ms: number, more: Partial<Scenario> = {}): Scenario => ({ ms, setup: s => s.queue(scene(raw)), ...more })
const feel = (mood: string) => played({ setting: 'meadow', props: [], beats: [{ do: 'emote', mood, secs: 5 }] }, 5000)
const HATS: [string, string][] = [['wizard', 'library'], ['miner', 'cave'], ['straw', 'beach'], ['tophat', 'meadow'], ['nightcap', 'night']]
const still = () => 0.5

const SCENARIOS: Record<string, Scenario> = {
  sad: feel('sad'),
  angry: feel('angry'),
  surprised: feel('surprised'),
  love: feel('love'),
  crouch: played({
    setting: 'forest', mood: 'sad', props: [{ id: 'c', kind: 'computer', x: 15 }],
    beats: [{ do: 'walk', to: 70 }, { do: 'dig', secs: 2 }, { do: 'type', at: 'c', secs: 2 }, { do: 'walk', to: 60 }],
  }, 12000),
  moods: played({
    setting: 'meadow', props: [{ id: 't', kind: 'tree', x: 85 }],
    beats: [
      { do: 'walk', to: 30 },
      ...['happy', 'love', 'sad', 'angry', 'surprised', 'confused', 'sleepy', 'focused', 'worried'].map(mood => ({ do: 'emote', mood, secs: 2 })),
    ],
  }, 22000),
  actions: played({
    setting: 'library', mood: 'focused', props: [{ id: 'c', kind: 'computer', x: 70 }, { id: 'k', kind: 'crate', x: 20 }],
    beats: [
      { do: 'read', secs: 2.5 }, { do: 'type', at: 'c', secs: 2 }, { do: 'carry', at: 'k' }, { do: 'run', to: 90 }, { do: 'drop' },
      { do: 'wave' }, { do: 'shrug' }, { do: 'dance', secs: 2 }, { do: 'sleep', secs: 2.5 }, { do: 'celebrate' },
    ],
  }, 26000),
  'meadow-readme': played({
    setting: 'meadow',
    props: [{ id: 't', kind: 'tree', x: 8 }, { id: 'c', kind: 'computer', x: 40 }, { id: 'r', kind: 'sign', x: 62, label: 'README.md' }, { id: 'b', kind: 'bug', x: 88 }],
    beats: [{ do: 'walk', to: 20 }, { do: 'look', at: 'r', react: '!' }, { do: 'say', text: 'Adding lang.ts to the README file list. Field notes done!' }],
  }, 9000),
  'forest-bughunt': played({
    setting: 'forest',
    props: [{ id: 's', kind: 'sign', x: 25, label: 'email.py:75' }, { id: 'b', kind: 'bug', x: 60, label: 'no rate limit' }, { id: 'm', kind: 'mushroom', x: 85 }],
    beats: [{ do: 'look', at: 's', react: '?' }, { do: 'think', text: 'A TODO where the limits should be...' }, { do: 'squash', at: 'b' }, { do: 'celebrate' }],
  }, 12000),
  'cave-dig': played({
    setting: 'cave',
    props: [{ id: 'k', kind: 'chest', x: 70, label: 'models/' }, { id: 'r', kind: 'rock', x: 30 }, { id: 'l', kind: 'lamp', x: 50 }],
    beats: [{ do: 'walk', to: 60 }, { do: 'dig', secs: 2 }, { do: 'look', at: 'k', react: '!' }, { do: 'say', text: '25 files, zero commits!' }],
  }, 8000),
  'night-think': played({
    setting: 'night',
    props: [{ id: 'f', kind: 'flag', x: 80 }, { id: 'c', kind: 'crate', x: 45 }, { id: 's', kind: 'scroll', x: 20 }],
    beats: [{ do: 'walk', to: 70 }, { do: 'jump' }, { do: 'think', text: 'mtg-tracker has 27 changed files...' }],
  }, 7000),
  desert: played({
    setting: 'desert', props: [{ id: 'c', kind: 'cactus', x: 30 }, { id: 'b', kind: 'books', x: 55 }, { id: 'r', kind: 'rock', x: 80 }],
    beats: [{ do: 'walk', to: 60 }],
  }, 4000),
  library: played({ setting: 'library', props: [{ id: 'b', kind: 'books', x: 30 }, { id: 'l', kind: 'lamp', x: 60 }, { id: 's', kind: 'scroll', x: 80 }], beats: [{ do: 'walk', to: 45 }] }, 3000),
  space: played({ setting: 'space', props: [{ id: 'f', kind: 'flag', x: 60 }, { id: 'r', kind: 'rock', x: 30 }], beats: [{ do: 'jump' }] }, 3000),
  beach: played({ setting: 'beach', props: [{ id: 'k', kind: 'chest', x: 60 }, { id: 'c', kind: 'crate', x: 30 }], beats: [{ do: 'walk', to: 80 }] }, 3000),

  // a crowded world: its props spread out, and a planted sign finds a free spot
  crowd: played({
    setting: 'beach',
    props: [
      { id: 'a', kind: 'sign', x: 40, label: 'drawBubble, line 749' }, { id: 'b', kind: 'sign', x: 46, label: 'bubble' },
      { id: 'c', kind: 'scroll', x: 43, label: 'layout notes' }, { id: 'd', kind: 'crate', x: 20 },
    ],
    beats: [{ do: 'wait', secs: 1 }, { do: 'plant_sign', label: 'overlap fixed?', x: 44, id: 'n' }, { do: 'wait', secs: 2 }],
  }, 14000, { times: [500, 13000], rand: still }),
  // walking past a sign leaves no gap in its board
  sign: played({ setting: 'cave', props: [{ id: 's', kind: 'sign', x: 45, label: 'Numeric columns 16' }], beats: [{ do: 'walk', to: 70 }] }, 4000,
    { columns: 60, every: 250, rand: still }),
  // walking in front of a sign, then talking next to it: the bubble and the board never cut into each other
  signtalk: played({
    setting: 'cave', props: [{ id: 's', kind: 'sign', x: 40, label: 'R_HUNT 340 vs 130' }, { id: 'r', kind: 'rock', x: 85 }],
    beats: [
      { do: 'walk', to: 42 }, { do: 'look', at: 's', react: '!' }, { do: 'say', text: 'Predators see more than twice as far as the boids do.' },
      { do: 'walk', to: 30 }, { do: 'think', text: 'Intentional, judging by the comments.' },
    ],
  }, 22000, { columns: 80, rand: still }),
  // two helpers arrive, work and report back
  helpers: played({
    setting: 'forest', props: [{ id: 's', kind: 'sign', x: 70, label: 'tests/' }],
    beats: [{ do: 'walk', to: 30 }, { do: 'ponder', secs: 6 }, { do: 'wait', secs: 4 }, { do: 'ponder', secs: 6 }],
  }, 22000, {
    every: 1500, rand: seeded(42),
    at: {
      1000: s => s.helpers.start('c1', 'explore tests'),
      2500: s => s.helpers.start('c2', 'check the config'),
      7000: s => s.helpers.activity('a1', 'Read'),
      7600: s => s.helpers.activity('a2', 'Grep'),
      10000: s => s.helpers.activity('a1', 'Bash'),
      13000: s => s.helpers.done('c1'),
      16000: s => s.helpers.done('c2'),
    },
  }),
  // every hat in a fitting setting: standing, jumping, with an emote balloon, carrying
  ...Object.fromEntries(HATS.map(([hat, setting]) => [`hat-${hat}`, played({
    setting, hat, props: [{ id: 'k', kind: 'crate', x: 75 }],
    beats: [{ do: 'walk', to: 30 }, { do: 'wait', secs: 1 }, { do: 'jump' }, { do: 'emote', mood: 'surprised', secs: 2 }, { do: 'carry', at: 'k' }, { do: 'wait', secs: 1 }],
  }, 14000, { columns: 48, every: 50, rand: still })])),
}

function play(s: Scenario): Frames {
  const columns = s.columns ?? 100
  const rows = s.rows ?? 10
  const isKept = (t: number) => (s.times ? s.times.includes(t) : t % (s.every ?? 500) === 0)
  const stage = new Stage(s.rand ?? seeded(7))
  stage.frame(columns, rows) // size the stage first, so walk targets are in this scenario's columns
  s.setup(stage)
  const out: Frames = { columns, rows, frames: {}, x: {} }
  for (let t = 0; t <= s.ms; t += 50) {
    s.at?.[t]?.(stage)
    stage.step(1_000_000 + t)
    if (!isKept(t)) continue
    out.frames[String(t)] = stage.frame(columns, rows)
    out.x[String(t)] = stage.figureColumn
  }
  return out
}

/** Every face, close up and looking at the camera. */
function faces(): Frames {
  const FACES: Face[] = ['ahead', 'right', 'down', 'happy', 'sad', 'angry', 'wide', 'confused', 'shut', 'focused', 'squint', 'blink']
  const out: Frames = { columns: 13, rows: 5, frames: {}, x: {} }
  FACES.forEach((face, i) => {
    const c = new Canvas(13, 5)
    c.sprite(1, 1, claude({ face, back: 'down', front: 'down', walk: 0, airborne: false, crouch: false, left: false }), TINTS.normal)
    out.frames[String(i)] = c.encode()
    out.x[String(i)] = 1
  })
  return out
}

const all: Record<string, () => Frames> = { ...Object.fromEntries(Object.entries(SCENARIOS).map(([name, s]) => [name, () => play(s)])), faces }
const wanted = process.argv.slice(2)
const unknown = wanted.filter(name => !(name in all))
if (unknown.length) throw new Error(`unknown scenario: ${unknown.join(', ')}; one of: ${Object.keys(all).join(', ')}`)
const out: Record<string, Frames> = wanted.length && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const names = wanted.length ? wanted : Object.keys(all)
for (const name of names) out[name] = all[name]!()
mkdirSync('dev/out', { recursive: true })
writeFileSync(OUT, JSON.stringify(out))
console.log(`wrote ${names.length} scenarios to ${OUT}`)
