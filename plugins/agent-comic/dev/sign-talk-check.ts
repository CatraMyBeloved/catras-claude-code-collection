// Claude walking in front of a sign, then talking next to it: bun dev/sign-talk-check.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseScene } from '../hooks/scene'
import { Stage } from '../hooks/stage'

const scene = parseScene(JSON.stringify({
  setting: 'cave',
  props: [{ id: 's', kind: 'sign', x: 40, label: 'R_HUNT 340 vs 130' }, { id: 'r', kind: 'rock', x: 85 }],
  beats: [
    { do: 'walk', to: 42 }, { do: 'look', at: 's', react: '!' },
    { do: 'say', text: 'Predators see more than twice as far as the boids do.' },
    { do: 'walk', to: 30 }, { do: 'think', text: 'Intentional, judging by the comments.' },
  ],
}))
if ('error' in scene) throw new Error(scene.error)
const stage = new Stage(() => 0.5)
stage.frame(80, 10)
stage.queue(scene)
const frames: Record<string, string> = {}
const x: Record<string, number> = {}
for (let t = 0; t <= 22_000; t += 50) {
  stage.step(1_000_000 + t)
  if (t % 500 === 0) { frames[String(t)] = stage.frame(80, 10); x[String(t)] = stage.figureColumn }
}
const path = 'dev/out/frames.json'
const out = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
out.signtalk = { columns: 80, rows: 10, frames, x }
writeFileSync(path, JSON.stringify(out))
