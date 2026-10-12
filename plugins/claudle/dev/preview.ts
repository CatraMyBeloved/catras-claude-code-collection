// Renders header frames and icons to JSON for dev/preview.py.
//   bun dev/preview.ts <out dir>
import { header, headerRows, ICON_COLUMNS, ICON_ROWS, iconCells } from '../hooks/art'
import type { Mood, Scene } from '../hooks/art'
import { GAMES } from '../hooks/games'

const out = process.argv[2] ?? 'dev/out'
const moods: Mood[] = ['idle', 'thinking', 'watching', 'grading', 'correct', 'wrong', 'confused']
const clips: Record<string, { columns: number; rows: number; frames: string[] }> = {}

for (const columns of [96, 56]) {
  for (const mood of moods) {
    const scene: Scene = { mood, since: 0, title: 'Off-By-One Survivor', xp: 420, progress: 0.3, nextAt: 700, streak: 3 }
    clips[`${mood}-${columns}`] = {
      columns,
      rows: headerRows(columns),
      frames: [300, 700, 1100, 1500, 3200].map(t => header(columns, scene, t)),
    }
  }
}
for (const g of GAMES) clips[`icon-${g.id}`] = { columns: ICON_COLUMNS, rows: ICON_ROWS, frames: [iconCells(g.id)] }

await Bun.write(`${out}/frames.json`, JSON.stringify(clips))
console.log(`${Object.keys(clips).length} clips -> ${out}/frames.json`)
