// Draws the same tour moments both ways: the terminal's cells (for sheet.py) and the desktop's SVG.
//   bun dev/svg-compare.ts <out dir>
import { writeFileSync } from 'node:fs'

import { demoScene } from '../hooks/demo'
import { Stage } from '../hooks/stage'
import { stillSvg } from '../hooks/svg'

const out = process.argv[2] ?? 'dev/out'
const stage = new Stage(() => 0.42)
stage.step(1)
stage.queue(demoScene(), true)
const cells: Record<string, string> = {}
let html = '<!doctype html><meta charset="utf-8"><body style="background:#1e1f28;margin:0">'
for (let t = 1000, n = 0; t <= 41000; t += 50) {
  stage.step(t)
  if ((t - 1000) % 8000 !== 3000) continue
  cells[`m${n}`] = stage.frame(120, 10)
  html += `<div style="height:160px">${stillSvg(stage.frameCanvas(120, 10)).replace(/width="\d+" height="\d+"/, 'width="960" height="160"')}</div>`
  n++
}
writeFileSync(`${out}/compare.html`, html)
writeFileSync(`${out}/compare.json`, JSON.stringify(cells))
