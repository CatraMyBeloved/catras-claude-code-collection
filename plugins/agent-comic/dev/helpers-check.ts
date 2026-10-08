// Two helpers (subagents) arrive, work, and report back: bun dev/helpers-check.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseScene } from '../hooks/scene'
import { Stage } from '../hooks/stage'

const scene = parseScene(JSON.stringify({
  setting: 'forest', props: [{ id: 's', kind: 'sign', x: 70, label: 'tests/' }],
  beats: [{ do: 'walk', to: 30 }, { do: 'ponder', secs: 6 }, { do: 'wait', secs: 4 }, { do: 'ponder', secs: 6 }],
}))
if ('error' in scene) throw new Error(scene.error)
// a seeded PRNG (mulberry32): random enough for spot picking, the same frames every run
let seed = 42
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const stage = new Stage(rand)
stage.frame(100, 10)
stage.queue(scene)
const frames: Record<string, string> = {}
const x: Record<string, number> = {}
const events: Record<number, () => void> = {
  1000: () => stage.helperStart('c1', 'explore tests'),
  2500: () => stage.helperStart('c2', 'check the config'),
  7000: () => stage.helperActivity('a1', 'Read'),
  7600: () => stage.helperActivity('a2', 'Grep'),
  10000: () => stage.helperActivity('a1', 'Bash'),
  13000: () => stage.helperDone('c1'),
  16000: () => stage.helperDone('c2'),
}
for (let t = 0; t <= 22_000; t += 50) {
  events[t]?.()
  stage.step(1_000_000 + t)
  const f = stage.frame(100, 10)
  if (t % 1500 === 0) { frames[String(t)] = f; x[String(t)] = 50 }
}
const path = 'dev/out/frames.json'
const out = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
out.helpers = { columns: 100, rows: 10, frames, x }
writeFileSync(path, JSON.stringify(out))
