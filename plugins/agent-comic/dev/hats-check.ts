// Every hat in a fitting setting: standing, jumping, with an emote balloon, carrying: bun dev/hats-check.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseScene } from '../hooks/scene'
import { Stage } from '../hooks/stage'

const HATS: [string, string][] = [['wizard', 'library'], ['miner', 'cave'], ['straw', 'beach'], ['tophat', 'meadow'], ['nightcap', 'night']]
const path = 'dev/out/frames.json'
const out = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
for (const [hat, setting] of HATS) {
  const scene = parseScene(JSON.stringify({
    setting, hat, props: [{ id: 'k', kind: 'crate', x: 75 }],
    beats: [{ do: 'walk', to: 30 }, { do: 'wait', secs: 1 }, { do: 'jump' }, { do: 'emote', mood: 'surprised', secs: 2 }, { do: 'carry', at: 'k' }, { do: 'wait', secs: 1 }],
  }))
  if ('error' in scene) throw new Error(scene.error)
  const stage = new Stage(() => 0.5)
  stage.frame(48, 10)
  stage.queue(scene)
  const frames: Record<string, string> = {}
  const x: Record<string, number> = {}
  for (let t = 0; t <= 14_000; t += 50) {
    stage.step(1_000_000 + t)
    const f = stage.frame(48, 10)
    frames[String(t)] = f
    x[String(t)] = stage.figureColumn
  }
  out[`hat-${hat}`] = { columns: 48, rows: 10, frames, x }
}
writeFileSync(path, JSON.stringify(out))
