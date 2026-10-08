// Plays test scenes through the real Stage and writes the frames as JSON for
// sheet.py to turn into PNGs. Run from the mod folder:
//   bun dev/frames.ts && python dev/sheet.py
// Options: bun dev/frames.ts [columns] [rows] [stepMs]

import { writeFileSync, mkdirSync } from 'node:fs'

import { parseScene } from '../hooks/scene'
import type { Scene } from '../hooks/scene'
import { Stage } from '../hooks/stage'

const columns = Number(process.argv[2] ?? 100)
const rows = Number(process.argv[3] ?? 10)
const stepMs = Number(process.argv[4] ?? 500)

/** A small deterministic PRNG (mulberry32) so every run renders the same frames. */
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

const feel = (mood: string) => ({
  ms: 5000,
  scene: scene({ setting: 'meadow', props: [], beats: [{ do: 'emote', mood, secs: 5 }] }),
})

const SCENES: Record<string, { scene: Scene; ms: number }> = {
  sad: feel('sad'),
  angry: feel('angry'),
  surprised: feel('surprised'),
  love: feel('love'),
  crouch: {
    ms: 12000,
    scene: scene({
      setting: 'forest',
      mood: 'sad',
      props: [{ id: 'c', kind: 'computer', x: 15 }],
      beats: [{ do: 'walk', to: 70 }, { do: 'dig', secs: 2 }, { do: 'type', at: 'c', secs: 2 }, { do: 'walk', to: 60 }],
    }),
  },
  moods: {
    ms: 22000,
    scene: scene({
      setting: 'meadow',
      props: [{ id: 't', kind: 'tree', x: 85 }],
      beats: [
        { do: 'walk', to: 30 },
        ...['happy', 'love', 'sad', 'angry', 'surprised', 'confused', 'sleepy', 'focused', 'worried'].map(mood => ({ do: 'emote', mood, secs: 2 })),
      ],
    }),
  },
  actions: {
    ms: 26000,
    scene: scene({
      setting: 'library',
      mood: 'focused',
      props: [{ id: 'c', kind: 'computer', x: 70 }, { id: 'k', kind: 'crate', x: 20 }],
      beats: [
        { do: 'read', secs: 2.5 }, { do: 'type', at: 'c', secs: 2 }, { do: 'carry', at: 'k' }, { do: 'run', to: 90 }, { do: 'drop' },
        { do: 'wave' }, { do: 'shrug' }, { do: 'dance', secs: 2 }, { do: 'sleep', secs: 2.5 }, { do: 'celebrate' },
      ],
    }),
  },
  'meadow-readme': {
    ms: 9000,
    scene: scene({
      setting: 'meadow',
      props: [{ id: 't', kind: 'tree', x: 8 }, { id: 'c', kind: 'computer', x: 40 }, { id: 'r', kind: 'sign', x: 62, label: 'README.md' }, { id: 'b', kind: 'bug', x: 88 }],
      beats: [{ do: 'walk', to: 20 }, { do: 'look', at: 'r', react: '!' }, { do: 'say', text: 'Adding lang.ts to the README file list. Field notes done!' }],
    }),
  },
  'forest-bughunt': {
    ms: 12000,
    scene: scene({
      setting: 'forest',
      props: [{ id: 's', kind: 'sign', x: 25, label: 'email.py:75' }, { id: 'b', kind: 'bug', x: 60, label: 'no rate limit' }, { id: 'm', kind: 'mushroom', x: 85 }],
      beats: [{ do: 'look', at: 's', react: '?' }, { do: 'think', text: 'A TODO where the limits should be...' }, { do: 'squash', at: 'b' }, { do: 'celebrate' }],
    }),
  },
  'cave-dig': {
    ms: 8000,
    scene: scene({
      setting: 'cave',
      props: [{ id: 'k', kind: 'chest', x: 70, label: 'models/' }, { id: 'r', kind: 'rock', x: 30 }, { id: 'l', kind: 'lamp', x: 50 }],
      beats: [{ do: 'walk', to: 60 }, { do: 'dig', secs: 2 }, { do: 'look', at: 'k', react: '!' }, { do: 'say', text: '25 files, zero commits!' }],
    }),
  },
  'night-think': {
    ms: 7000,
    scene: scene({
      setting: 'night',
      props: [{ id: 'f', kind: 'flag', x: 80 }, { id: 'c', kind: 'crate', x: 45 }, { id: 's', kind: 'scroll', x: 20 }],
      beats: [{ do: 'walk', to: 70 }, { do: 'jump' }, { do: 'think', text: 'mtg-tracker has 27 changed files...' }],
    }),
  },
  'desert-library-space-beach': {
    ms: 4000,
    scene: scene({
      setting: 'desert',
      props: [{ id: 'c', kind: 'cactus', x: 30 }, { id: 'b', kind: 'books', x: 55 }, { id: 'r', kind: 'rock', x: 80 }],
      beats: [{ do: 'walk', to: 60 }],
    }),
  },
  library: { ms: 3000, scene: scene({ setting: 'library', props: [{ id: 'b', kind: 'books', x: 30 }, { id: 'l', kind: 'lamp', x: 60 }, { id: 's', kind: 'scroll', x: 80 }], beats: [{ do: 'walk', to: 45 }] }) },
  space: { ms: 3000, scene: scene({ setting: 'space', props: [{ id: 'f', kind: 'flag', x: 60 }, { id: 'r', kind: 'rock', x: 30 }], beats: [{ do: 'jump' }] }) },
  beach: { ms: 3000, scene: scene({ setting: 'beach', props: [{ id: 'k', kind: 'chest', x: 60 }, { id: 'c', kind: 'crate', x: 30 }], beats: [{ do: 'walk', to: 80 }] }) },
}

const out: Record<string, { columns: number; rows: number; frames: Record<string, string>; x: Record<string, number> }> = {}
for (const [name, { scene, ms }] of Object.entries(SCENES)) {
  const stage = new Stage(seeded(7))
  stage.queue(scene)
  const frames: Record<string, string> = {}
  const x: Record<string, number> = {}
  for (let t = 0; t <= ms; t += 50) {
    stage.step(1_000_000 + t)
    if (t % stepMs === 0) {
      frames[String(t)] = stage.frame(columns, rows)
      x[String(t)] = stage.figureColumn
    }
  }
  out[name] = { columns, rows, frames, x }
}

mkdirSync('dev/out', { recursive: true })
writeFileSync('dev/out/frames.json', JSON.stringify(out))
console.log(`wrote ${Object.keys(out).length} scenes to dev/out/frames.json`)
