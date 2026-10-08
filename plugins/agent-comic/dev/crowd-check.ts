// A crowded world (the overlap screenshot): bun dev/crowd-check.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseScene } from '../hooks/scene'
import { Stage } from '../hooks/stage'

const scene = parseScene(JSON.stringify({
  setting: 'beach',
  props: [
    { id: 'a', kind: 'sign', x: 40, label: 'drawBubble, line 749' },
    { id: 'b', kind: 'sign', x: 46, label: 'bubble' },
    { id: 'c', kind: 'scroll', x: 43, label: 'layout notes' },
    { id: 'd', kind: 'crate', x: 20 },
  ],
  beats: [{ do: 'wait', secs: 1 }, { do: 'plant_sign', label: 'overlap fixed?', x: 44, id: 'n' }, { do: 'wait', secs: 2 }],
}))
if ('error' in scene) throw new Error(scene.error)
const stage = new Stage(() => 0.5)
stage.frame(100, 10)
stage.queue(scene)
const frames: Record<string, string> = {}
const x: Record<string, number> = {}
for (let t = 0; t <= 14_000; t += 50) {
  stage.step(1_000_000 + t)
  if (t === 500 || t === 13_000) { frames[String(t)] = stage.frame(100, 10); x[String(t)] = 50 }
}
const path = 'dev/out/frames.json'
const out = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
out.crowd = { columns: 100, rows: 10, frames, x }
writeFileSync(path, JSON.stringify(out))
