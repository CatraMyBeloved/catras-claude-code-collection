// Plays the comic tour through the real Stage in desktop-sized chunks, as the desktop
// band does, and reports each chunk's size and frame rate; writes a few chunks to an
// HTML page that plays them back to back.
//   bun dev/svg-check.ts <out dir> [columns]
import { writeFileSync } from 'node:fs'

import type { Canvas } from '../hooks/canvas'
import { demoScene } from '../hooks/demo'
import { Stage } from '../hooks/stage'
import { chunkSvg, stillSvg } from '../hooks/svg'

const out = process.argv[2] ?? 'dev/out'
const columns = Number(process.argv[3] ?? 120)
const rows = 10
const FRAME = 50
const CHUNK = 1000

const stage = new Stage(() => 0.42)
stage.step(1)
stage.queue(demoScene(), true)
const chunks: { svg: string; every: number }[] = []
let t = 1000
for (let n = 0; n < 60; n++) {
  const frames: Canvas[] = []
  for (let k = 0; k < CHUNK / FRAME; k++, t += FRAME) {
    stage.step(t)
    frames.push(stage.frameCanvas(columns, rows))
  }
  let done = false
  for (let every = 1; every <= frames.length && !done; every++) {
    const svg = chunkSvg(frames.filter((_, i) => i % every === 0), FRAME * every)
    if (svg) {
      chunks.push({ svg, every })
      done = true
    }
  }
  if (!done) chunks.push({ svg: stillSvg(frames.at(-1)!), every: 99 })
}
const sizes = chunks.map(c => c.svg.length)
console.log(`columns ${columns}: chunk sizes min ${Math.min(...sizes)} max ${Math.max(...sizes)} avg ${Math.round(sizes.reduce((a, b) => a + b) / sizes.length)}`)
console.log(`frame rate: ${chunks.filter(c => c.every === 1).length} of ${chunks.length} chunks at 20 fps; others: ${chunks.filter(c => c.every > 1).map(c => `${Math.round(20 / c.every)}fps`).join(' ')}`)
// a page that swaps chunks every second, as the desktop would
const data = JSON.stringify(chunks.map(c => 'data:image/svg+xml;base64,' + Buffer.from(c.svg).toString('base64')))
writeFileSync(`${out}/comic-desktop.html`, `<!doctype html><meta charset="utf-8"><body style="background:#1e1f28;margin:8px">
<img id="band" style="width:100%;image-rendering:pixelated"><div id="n" style="color:#888;font:12px sans-serif"></div>
<script>const c=${data};let i=0;function go(){document.getElementById('band').src=c[i%c.length];document.getElementById('n').textContent='chunk '+(i%c.length+1)+' of '+c.length;i++}go();setInterval(go,1000)</script>`)
for (const n of [3, 12, 25, 40]) writeFileSync(`${out}/chunk-${n}.svg`, chunks[n]!.svg)
