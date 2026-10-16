// What the figure gives off, each a short animation from `start` to `until`: sparkles, puffs of
// smoke, hearts, tears, steam, sweat, z's, dust and a balloon let go. And particles (dirt from a
// shovel, drops from a watering can) that fly in an arc under a little gravity.

import type { Canvas } from './canvas'
import { BALLOON_UP, BITS, P } from './sprites'

export type Effect =
  | { kind: 'sparkle'; x: number; y: number; color: number; start: number; until: number }
  | { kind: 'poof' | 'heart' | 'tear' | 'steam' | 'sweat' | 'zzz' | 'dust' | 'balloon'; x: number; y: number; start: number; until: number }
export type EffectKind = Effect['kind']

export type Particle = { x: number; y: number; vx: number; vy: number; until: number; color: number }

/** The particles still in the air at `now`, each moved on by `dt` seconds. */
export function fly(particles: readonly Particle[], now: number, dt: number): Particle[] {
  const flying = particles.filter(p => p.until > now)
  for (const p of flying) {
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vy += 40 * dt
  }
  return flying
}

/** A particle is a 2-pixel clump. */
export function drawParticle(c: Canvas, p: Particle) {
  c.set(p.x, p.y, p.color)
  c.set(p.x + 1, p.y, p.color)
}

export function drawEffect(c: Canvas, e: Effect, now: number) {
  const t = (now - e.start) / (e.until - e.start)
  switch (e.kind) {
    case 'sparkle':
      // a dot that opens into a plus and closes again
      c.set(e.x, e.y, P.white)
      if (t >= 0.33 && t <= 0.8) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) c.set(e.x + dx, e.y + dy, e.color)
      return
    case 'poof': {
      // eight 2-pixel clumps flying out, white turning grey
      const r = 1.5 + t * 5
      const color = t < 0.5 ? P.white : P.mist
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        const px = e.x + Math.cos(a) * r * 1.6
        const py = e.y + Math.sin(a) * r * 0.8
        c.set(px, py, color)
        c.set(px + 1, py, color)
      }
      return
    }
    case 'heart': {
      // floats up with a slight sway, the last stretch shrunk to a dot
      const x = e.x + Math.round(Math.sin(t * 6))
      const y = e.y - Math.round(t * 6)
      if (t < 0.8) c.sprite(x, y, BITS.heart.rows, BITS.heart.palette)
      else c.set(x + 2, y + 1, P.coral)
      return
    }
    case 'tear':
      // a drop running down from the eye: a light head over a darker tail
      c.set(e.x, e.y + t * 5, P.sky)
      c.set(e.x, e.y + t * 5 - 1, P.navy)
      return
    case 'steam': {
      const y = e.y - t * 4
      const color = t < 0.5 ? P.silver : P.steel
      c.set(e.x, y, color)
      c.set(e.x + 1, y - 1, color)
      return
    }
    case 'sweat': {
      const y = e.y + t * 3
      c.set(e.x, y, P.white)
      c.set(e.x, y + 1, P.sky)
      return
    }
    case 'zzz': {
      // a z drifting up and right, growing into a Z
      const col = e.x + Math.round(t * 4)
      const row = Math.floor((e.y - t * 6) / 2)
      if (row >= 0) c.text(col, row, t < 0.5 ? 'z' : 'Z', t < 0.7 ? P.silver : P.steel)
      return
    }
    case 'dust':
      c.set(e.x, e.y - t * 2, t < 0.5 ? P.silver : P.mist)
      c.set(e.x + 1, e.y - t * 2, P.mist)
      return
    case 'balloon': {
      // let go: it drifts up and off the top, swaying
      const y = Math.round(e.y - t * (e.y + 8))
      const x = e.x + Math.round(Math.sin(t * 9) * 1.5)
      c.sprite(x, y, BALLOON_UP.rows, BALLOON_UP.palette)
      return
    }
  }
}
