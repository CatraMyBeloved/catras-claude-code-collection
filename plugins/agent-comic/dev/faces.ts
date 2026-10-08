// Close-up of the face looking at the camera: the old sprite next to the current one.
// bun dev/faces.ts && python dev/gallery.py faces 0,1,2,3 <labels> 13
import { readFileSync, writeFileSync } from 'node:fs'

import { Canvas } from '../hooks/canvas'
import { TINTS, claude } from '../hooks/sprites'




const pose = { back: 'down', front: 'down', walk: 0, airborne: false, crouch: false } as const
const FACES = ['ahead', 'right', 'down', 'happy', 'sad', 'angry', 'wide', 'confused', 'shut', 'focused', 'squint', 'blink'] as const
const sprites = FACES.map(face => claude({ ...pose, face, left: false }))
const frames: Record<string, string> = {}
const x: Record<string, number> = {}
sprites.forEach((art, i) => {
  const c = new Canvas(13, 5)
  c.sprite(1, 1, art, TINTS.normal)
  frames[String(i)] = c.encode()
  x[String(i)] = 1
})
const out = JSON.parse(readFileSync('dev/out/frames.json', 'utf8'))
out.faces = { columns: 13, rows: 5, frames, x }
writeFileSync('dev/out/frames.json', JSON.stringify(out))
