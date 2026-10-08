// The pond as pixels: grass, water, Claude fishing (walking in first), and the signs.

import type { EngineInterface } from 'claude-code'

import { Paint } from './paint'

export type Kit = Awaited<ReturnType<EngineInterface['comic']['kit']>>
export type Stop = { id: string | null; name: string }
/** Where Claude came in from, and when: he walks from that edge to his spot. */
export type Arrival = { from: -1 | 1 | null; at: number }

const WALK_PX_PER_SEC = 14

/** The pond at time `now`: grass, water, Claude fishing (walking in first), the signs. */
export function draw(art: Kit, columns: number, rows: number, now: number, arrival: Arrival | null, signs: { left: Stop | null; right: Stop | null }): string {
  const p = new Paint(columns, rows)
  const P = art.palette
  const H = rows * 2
  const ground = H - 2

  p.rect(0, ground, columns, 2, P.moss!)
  for (let x = 0; x < columns; x += 3) p.set(x, ground, P.leaf!)

  const pondLeft = Math.floor(columns * 0.55)
  const pondRight = columns - 6
  p.rect(pondLeft, ground - 1, pondRight - pondLeft, 3, P.navy!)
  p.rect(pondLeft + 1, ground - 1, pondRight - pondLeft - 2, 1, P.sky!)
  const glint = pondLeft + 2 + (Math.floor(now / 300) % Math.max(1, pondRight - pondLeft - 4))
  p.set(glint, ground - 1, P.white!)

  // Claude: in from the side he came from, then on his spot at the water's edge
  const spot = pondLeft - 13
  const elapsed = arrival ? (now - arrival.at) / 1000 : Infinity
  const start = arrival?.from === -1 ? -11 : arrival?.from === 1 ? columns : spot
  const dist = spot - start
  const travelled = Math.min(Math.abs(dist), elapsed * WALK_PX_PER_SEC)
  const x = Math.round(start + Math.sign(dist) * travelled)
  const isWalking = travelled < Math.abs(dist)
  const c = art.claude
  // a bite every eight seconds or so: he lights up for a moment
  const isBite = !isWalking && now % 8000 < 1500
  const frame = isWalking ? c.walk[Math.floor(now / 120) % 4]! : isBite ? c.happy : now % 4000 < 150 ? c.blink : c.stand
  const top = ground - frame.length
  p.sprite(x, top, frame, c.palette, isWalking && dist < 0)
  if (!isWalking) {
    // the rod, the line, and the bobber riding the ripples
    for (let i = 0; i < 7; i++) p.set(x + 10 + i, top + 2 - Math.floor(i / 2), P.wood!)
    const tipX = x + 16
    const tipY = top - 1
    const bob = isBite ? 1 : Math.floor(now / 600) % 2
    for (let y = tipY + 1; y < ground - 1 + bob; y++) p.set(tipX, y, P.silver!)
    p.set(tipX, ground - 2 + bob, P.red!)
    if (isBite) p.write(x + 5, Math.max(0, Math.floor(top / 2) - 1), '!', P.yellow!)
  }

  // the signs on to the neighbouring places, in the comic's colours
  const sign = art.sign
  if (signs.left) p.write(0, 1, ` ◂ ${signs.left.name} `, sign.fg, sign.bg)
  if (signs.right) {
    const label = ` ${signs.right.name} ▸ `
    p.write(columns - [...label].length, 1, label, sign.fg, sign.bg)
  }
  return p.encode()
}
