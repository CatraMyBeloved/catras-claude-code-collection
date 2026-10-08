// Claude walking past a sign, for the sign-gap check: bun dev/sign-check.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { parseScene } from '../hooks/scene'
import { Stage } from '../hooks/stage'

const scene = parseScene(JSON.stringify({ setting: 'cave', props: [{ id: 's', kind: 'sign', x: 45, label: 'Numeric columns 16' }], beats: [{ do: 'walk', to: 70 }] }))
if ('error' in scene) throw new Error(scene.error)
const stage = new Stage(() => 0.5)
stage.frame(60, 10)
stage.queue(scene)
const frames: Record<string, string> = {}
const x: Record<string, number> = {}
for (let t = 0; t <= 4000; t += 50) {
  stage.step(1_000_000 + t)
  if (t % 250 === 0) { frames[String(t)] = stage.frame(60, 10); x[String(t)] = stage.figureColumn }
}
const out = JSON.parse(readFileSync('dev/out/frames.json', 'utf8'))
out.sign = { columns: 60, rows: 10, frames, x }
writeFileSync('dev/out/frames.json', JSON.stringify(out))
