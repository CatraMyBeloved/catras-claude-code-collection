// The backdrop of every scene, back to front: the sky (with the local hour and the session's weather),
// a dim far layer, drifting motes and the ground. Also the task trail along the ground.

import type { Canvas } from './canvas'
import { CLOUD, RAIN, RAIN_CLOUD } from './hubart'
import { GOAL_FLAG, GOAL_FLAG_DONE, P, SKY_ART, bookColor } from './sprites'
import type { Look } from './sprites'
import { clamp, hash } from './util'

/** The session's sky, kept quiet: the local hour, and weather that follows how the work goes. */
export type Weather = 'clear' | 'cloudy' | 'rain'
export type Ambience = { hour: number; weather: Weather }

/** Sky, far layer, motes and ground, as `look` has them. */
export function drawBackdrop(c: Canvas, look: Look, now: number, ambience: Ambience) {
  drawSky(c, look, now, ambience)
  drawFar(c, look, now)
  drawMotes(c, look, now)
  drawGround(c, look)
}

/** The task trail: a line along the dirt, lit up to how much is done, a flag at its end. */
export function drawProgress(c: Canvas, p: { done: number; total: number }) {
  const W = c.columns
  const H = c.height
  const end = W - 5
  const lit = 1 + Math.round(clamp(p.done / p.total, 0, 1) * (end - 1))
  for (let x = 1; x < end; x++) {
    if (x < lit) c.set(x, H - 1, P.amber)
    else if (x % 3 === 0) c.set(x, H - 1, P.tan)
  }
  const flag = p.done >= p.total ? GOAL_FLAG_DONE : GOAL_FLAG
  c.sprite(end, H - 2 - flag.rows.length, flag.rows, flag.palette)
}

function drawSky(c: Canvas, look: Look, now: number, amb: Ambience) {
  const W = c.columns
  // out under the sky the local hour shows: a moon and stars at night, a low sun at dawn and dusk
  const isOpenSky = look.sky === 'sun' || look.sky === 'moon'
  const isNight = amb.hour >= 21 || amb.hour < 6
  const isLow = (amb.hour >= 18 && amb.hour < 21) || (amb.hour >= 6 && amb.hour < 8)
  if (look.sky === 'sun' && isNight) look = { ...look, sky: 'moon' }
  if (look.sky === 'sun' && isLow) {
    c.sprite(W - 12, 4, SKY_ART.sun.rows, SKY_ART.sun.palette)
    look = { ...look, sky: 'none' }
  }
  drawSkyArt(c, look, now)
  // clouds pass in front of the sun or moon
  if (isOpenSky) drawWeather(c, amb.weather, now)
}

function drawSkyArt(c: Canvas, look: Look, now: number) {
  const W = c.columns
  if (look.sky === 'stars' || look.sky === 'moon' || look.sky === 'planet') {
    // stars are the one place a lone pixel is right; a few twinkle
    for (let x = 1; x < W; x++) {
      if (hash(x * 3.7) > 0.09) continue
      const y = Math.floor(hash(x * 9.1) * (c.height - 9))
      const isTwinkling = hash(x * 5.3) < 0.3 && Math.sin(now / 300 + x) > 0.4
      c.set(x, y, isTwinkling ? P.white : P.steel)
    }
  }
  if (look.sky === 'none' || look.sky === 'stars') return
  const art = SKY_ART[look.sky]
  c.sprite(W - 12, 1, art.rows, art.palette)
}

/** One or two small clouds drifting over; rain clouds let a few drops fall. */
function drawWeather(c: Canvas, weather: Weather, now: number) {
  if (weather === 'clear') return
  const W = c.columns
  const H = c.height
  const art = weather === 'rain' ? RAIN_CLOUD : CLOUD
  const width = art.rows[0]!.length
  const t = now / 1000
  for (const [k, speed, y] of [[0, 1.2, 1], [1, 0.8, 3]] as const) {
    if (k === 1 && weather === 'cloudy') continue
    const x = Math.round(((k * 37 + t * speed) % (W + width + 6)) - width - 3)
    c.sprite(x, y, art.rows, art.palette)
    if (weather !== 'rain') continue
    for (let d = 0; d < 3; d++) {
      const fall = H - 4 - (y + art.rows.length)
      const dy = (t * 14 + d * 7 + k * 3) % (fall + 4)
      if (dy > fall) continue
      const dx = x + 2 + d * Math.floor((width - 4) / 2)
      c.set(dx, y + art.rows.length + dy, RAIN)
    }
  }
}

function drawFar(c: Canvas, look: Look, now: number) {
  const W = c.columns
  const H = c.height
  const { kind, color, accent } = look.far
  switch (kind) {
    case 'hills':
    case 'dunes':
    case 'craters': {
      // one slow sine: its steps lengthen and shorten smoothly, no jagged mix of runs
      const period = kind === 'dunes' ? 11 : kind === 'hills' ? 7 : 4
      const peak = kind === 'craters' ? 1.5 : 2.5
      for (let x = 0; x < W; x++) {
        const h = Math.round(peak + 0.5 + peak * Math.sin(x / period + 1))
        const crest = H - 3 - Math.max(1, h)
        for (let y = crest + 1; y <= H - 3; y++) c.set(x, y, color)
        c.set(x, crest, accent)
      }
      return
    }
    case 'pines': {
      for (let x0 = -3; x0 < W; x0 += 6 + Math.floor(hash(x0) * 4)) {
        const h = 5 + Math.floor(hash(x0 * 1.7) * 4)
        for (let k = 0; k < h; k++) {
          const half = Math.floor(k / 2)
          for (let dx = -half; dx <= half; dx++) c.set(x0 + dx, H - 3 - h + k + 1, dx < 0 ? accent : color)
        }
      }
      return
    }
    case 'stalactites': {
      for (let x = 0; x < W; x++) c.set(x, 0, color)
      for (const tip of stalactites(W)) {
        for (let k = 0; k < tip.len; k++) {
          const half = Math.max(0, Math.floor((tip.len - k) / 2) - 1)
          for (let dx = -half; dx <= half; dx++) c.set(tip.x + dx, 1 + k, dx < 0 ? accent : color)
        }
      }
      return
    }
    case 'shelves': {
      for (const plank of [H - 8, H - 14]) {
        if (plank < 3) continue
        for (let x = 0; x < W; x++) c.set(x, plank, accent)
        for (let x = 1; x < W - 1; x++) {
          if (hash(x * 2.3 + plank) < 0.18) continue
          const tall = hash(x * 4.1 + plank) < 0.5 ? 3 : 2
          const spine = bookColor(Math.floor(hash(x * 7.7 + plank) * 6))
          for (let y = plank - tall; y < plank; y++) c.set(x, y, spine)
        }
      }
      return
    }
    case 'sea': {
      const top = H - 6
      for (let y = top; y <= H - 3; y++) for (let x = 0; x < W; x++) c.set(x, y, color)
      // wave crests: short dashes drifting along the water
      for (let x0 = 0; x0 < W + 12; x0 += 9) {
        const x = ((x0 + Math.floor(now / 250)) % (W + 12)) - 6
        const y = top + 1 + (Math.floor(x0 / 9) % 2) * 2
        c.set(x, y, accent)
        c.set(x + 1, y, accent)
        c.set(x + 2, y, accent)
      }
      return
    }
  }
}

/** Where the cave's stalactites hang, the same at every frame. */
function stalactites(W: number): { x: number; len: number }[] {
  const tips: { x: number; len: number }[] = []
  for (let x = 3; x < W - 2; x += 7 + Math.floor(hash(x * 1.3) * 6)) tips.push({ x, len: 3 + Math.floor(hash(x * 2.9) * 4) })
  return tips
}

function drawMotes(c: Canvas, look: Look, now: number) {
  const { color, motion, count } = look.mote
  const W = c.columns
  const H = c.height
  const t = now / 1000
  if (motion === 'drip') {
    // drops fall from the stalactite tips, a 2-pixel streak each
    const tips = stalactites(W)
    for (let k = 0; k < Math.min(count, tips.length); k++) {
      const tip = tips[Math.floor(hash(k * 7.3) * tips.length)]!
      const span = H - 3 - (tip.len + 1)
      const y = tip.len + 1 + ((t * 9 + k * 5) % (span + 6))
      if (y > H - 3) continue
      c.set(tip.x, y, color)
      c.set(tip.x, y - 1, P.navy)
    }
    return
  }
  if (count === 0) return
  const n = Math.max(1, Math.round((count * W) / 100))
  for (let k = 0; k < n; k++) {
    const seedX = hash(k * 12.1) * W
    const seedY = 2 + hash(k * 4.7) * (H - 8)
    const phase = hash(k * 3.3) * 6
    let x = seedX
    let y = seedY
    switch (motion) {
      case 'drift':
        x = (seedX + t * 2) % W
        y = seedY + Math.sin(t * 0.8 + phase) * 1.5
        break
      case 'rise':
        y = H - 4 - ((seedY + t * 2) % (H - 6))
        x = seedX + Math.sin(t + phase)
        break
      case 'twinkle':
        if (Math.sin(t * 1.7 + phase * 3) < 0.3) continue
        x = seedX + Math.sin(t * 0.5 + phase) * 2
        y = seedY + Math.cos(t * 0.7 + phase)
        break
    }
    c.set(x, y, color)
  }
}

function drawGround(c: Canvas, look: Look) {
  const W = c.columns
  const H = c.height
  c.rect(0, H - 2, W, 1, look.grass)
  c.rect(0, H - 1, W, 1, look.dirt)
  // texture in deliberate clusters on a loose rhythm, never single random pixels
  for (let x = 2; x < W; x += 7 + Math.floor(hash(x) * 5)) {
    c.set(x, H - 2, look.grassHi)
    c.set(x + 1, H - 2, look.grassHi)
    c.set(x + 3, H - 1, look.dirtDark)
    c.set(x + 4, H - 1, look.dirtDark)
    if (look.tufts && hash(x * 1.9) < 0.55) {
      c.set(x, H - 3, look.grass)
      c.set(x + 1, H - 3, look.grass)
      c.set(x + 1, H - 4, look.grassHi)
    }
  }
}
