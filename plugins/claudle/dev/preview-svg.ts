// Writes the desktop's SVG header for every mood, and the icons, to one HTML page.
//   bun dev/preview-svg.ts <out dir>
import type { Mood, Scene } from '../hooks/art'
import { GAMES } from '../hooks/games'
import { headerSvg, iconSvg } from '../hooks/svg'

const out = process.argv[2] ?? 'dev/out'
const moods: Mood[] = ['idle', 'thinking', 'watching', 'grading', 'correct', 'wrong', 'confused']
let html = '<!doctype html><meta charset="utf-8"><body style="background:#1e1f28;color:#999;font:12px sans-serif;margin:8px">'
for (const columns of [96, 56]) {
  for (const mood of moods) {
    const scene: Scene = { mood, since: 0, title: 'Off-By-One Survivor', xp: 420, progress: 0.3, nextAt: 700, streak: 3 }
    const svg = headerSvg(columns, scene, 0)
    html += `<div>${mood} ${columns} cols, ${Math.round(svg.length / 1000)}k chars</div>${svg}`
    console.log(`${mood}-${columns}: ${svg.length} chars`)
  }
}
html += '<div>icons</div>' + GAMES.map(g => iconSvg(g.id)).join(' ')
await Bun.write(`${out}/svg.html`, html)
