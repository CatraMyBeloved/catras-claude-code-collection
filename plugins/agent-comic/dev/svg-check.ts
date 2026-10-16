// The desktop's drawing, checked: plays the comic tour through the real Stage in one-second chunks,
// as the desktop band does, and reports each chunk's size and frame rate. Writes to <out dir>:
//   comic-desktop.html   the chunks played back to back, as the desktop would
//   chunk-<n>.svg        a few of them
//   compare.html/.json   a few tour moments both ways: the desktop's SVG, and the terminal's cells (for sheet.py)
//   bun dev/svg-check.ts <out dir> [columns]

import { writeFileSync } from 'node:fs'

import type { Canvas } from '../hooks/canvas'
import { demoScene } from '../hooks/demo'
import { Stage } from '../hooks/stage'
import { fitChunk, stillSvg } from '../hooks/svg'

const out = process.argv[2] ?? 'dev/out'
const columns = Number(process.argv[3] ?? 120)
const rows = 10
const FRAME_MS = 50
const CHUNK_MS = 1000

function tour(): Stage {
  const stage = new Stage(() => 0.42)
  stage.step(1)
  stage.queue(demoScene(), true)
  return stage
}

// the tour in chunks
const stage = tour()
const chunks: { svg: string; every: number | null }[] = []
let t = 1000
for (let n = 0; n < 60; n++) {
  const frames: Canvas[] = []
  for (let k = 0; k < CHUNK_MS / FRAME_MS; k++, t += FRAME_MS) {
    stage.step(t)
    frames.push(stage.frameCanvas(columns, rows))
  }
  chunks.push(fitChunk(frames, FRAME_MS))
}
const sizes = chunks.map(c => c.svg.length)
const rate = (every: number | null) => (every === null ? 'still' : `${Math.round(1000 / FRAME_MS / every)}fps`)
console.log(`columns ${columns}: chunk sizes min ${Math.min(...sizes)} max ${Math.max(...sizes)} avg ${Math.round(sizes.reduce((a, b) => a + b) / sizes.length)}`)
console.log(`frame rate: ${chunks.filter(c => c.every === 1).length} of ${chunks.length} chunks at full rate; others: ${chunks.filter(c => c.every !== 1).map(c => rate(c.every)).join(' ')}`)
const data = JSON.stringify(chunks.map(c => 'data:image/svg+xml;base64,' + Buffer.from(c.svg).toString('base64')))
writeFileSync(`${out}/comic-desktop.html`, `<!doctype html><meta charset="utf-8"><body style="background:#1e1f28;margin:8px">
<img id="band" style="width:100%;image-rendering:pixelated"><div id="n" style="color:#888;font:12px sans-serif"></div>
<script>const c=${data};let i=0;function go(){document.getElementById('band').src=c[i%c.length];document.getElementById('n').textContent='chunk '+(i%c.length+1)+' of '+c.length;i++}go();setInterval(go,1000)</script>`)
for (const n of [3, 12, 25, 40]) writeFileSync(`${out}/chunk-${n}.svg`, chunks[n]!.svg)

// a few tour moments both ways
const moments = tour()
const cells: Record<string, string> = {}
let html = '<!doctype html><meta charset="utf-8"><body style="background:#1e1f28;margin:0">'
for (let t = 1000, n = 0; t <= 41000; t += FRAME_MS) {
  moments.step(t)
  if ((t - 1000) % 8000 !== 3000) continue
  cells[`m${n}`] = moments.frame(columns, rows)
  html += `<div style="height:160px">${stillSvg(moments.frameCanvas(columns, rows)).replace(/width="\d+" height="\d+"/, 'width="960" height="160"')}</div>`
  n++
}
writeFileSync(`${out}/compare.html`, html)
writeFileSync(`${out}/compare.json`, JSON.stringify(cells))
