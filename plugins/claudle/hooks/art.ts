// Pixel art for Claudle: the quiz-show header (logo, quizmaster Claude, XP bar)
// and the game icons. Same palette and figure as the agent-comic mod.

import type { GameId } from '../types'
import { Canvas, DEFAULT } from './canvas'

export const P = {
  ink: 0x181425, night: 0x262b44, slate: 0x3a4466, steel: 0x5a6988, mist: 0x8b9bb4, silver: 0xc0cbdc, white: 0xffffff,
  wine: 0x3e2731, bark: 0x733e39, wood: 0xb86f50, tan: 0xe4a672, sand: 0xead4aa,
  blood: 0xa22633, red: 0xe43b44, coral: 0xf6757a, amber: 0xfeae34, yellow: 0xfee761,
  leaf: 0x63c74d, moss: 0x3e8948, pine: 0x265c42, navy: 0x124e89, sky: 0x0099db, plum: 0x68386c, pink: 0xb55088,
}

export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/** Each game's color, used for its icon, card border and badge. */
export const GAME_COLOR: Record<GameId, number> = {
  'spot-the-bug': P.red,
  'what-prints': P.leaf,
  'two-truths': P.amber,
  'real-or-fake': P.sky,
  'review-court': P.pink,
  'big-o': P.coral,
}

// ── Icons: 8 px wide, 6 px tall (8 columns by 3 rows) ─────────────────

type Art = { rows: readonly string[]; palette: Record<string, number> }

export const ICONS: Record<GameId, Art> = {
  'spot-the-bug': {
    rows: ['.K....K.', '..K.hK..', '.KhrrdK.', 'K.rKrd.K', '..rKdd..', '.K.dd.K.'],
    palette: { K: P.ink, h: P.coral, r: P.red, d: P.blood },
  },
  'what-prints': {
    rows: ['ssssssss', 'sNNNNNNs', 'sNgNNNNs', 'sNNgNNNs', 'sNgNyyNs', 'ssssssss'],
    palette: { s: P.steel, N: P.ink, g: P.leaf, y: P.silver },
  },
  'two-truths': {
    rows: ['hh.hh.cc', 'GG.GG.RR', 'GW.GW.WR', 'WG.WG.RW', 'GG.GG.RR', 'gg.gg.dd'],
    palette: { h: P.leaf, G: P.moss, g: P.pine, W: P.white, c: P.coral, R: P.red, d: P.blood },
  },
  'real-or-fake': {
    rows: ['..wwww..', '.wwwwwm.', 'wwkwwkwm', 'wwwwwwwm', 'wwwwwwmm', 'w.wm.w.m'],
    palette: { w: P.white, m: P.silver, k: P.ink },
  },
  'review-court': {
    rows: ['.hhh....', 'BBBBh...', 'BBBB.h..', '.bbb..h.', '.......h', 'sSSSSSSs'],
    palette: { h: P.tan, B: P.wood, b: P.bark, S: P.pink, s: P.plum },
  },
  'big-o': {
    rows: ['s......r', 's......r', 's.....r.', 's....r..', 's.rrr...', 'ssssssss'],
    palette: { s: P.steel, r: P.coral },
  },
}

export const ICON_COLUMNS = 8
export const ICON_ROWS = 3

export function iconCells(id: GameId): string {
  return iconCanvas(id).encode()
}

export function iconCanvas(id: GameId): Canvas {
  const c = new Canvas(ICON_COLUMNS, ICON_ROWS)
  c.sprite(0, 0, ICONS[id].rows, ICONS[id].palette)

  return c
}

// ── Logo font: 3 by 5, scaled ──────────────────────────────────────────

const FONT: Record<string, string[]> = {
  C: ['.##', '#..', '#..', '#..', '.##'],
  L: ['#..', '#..', '#..', '#..', '###'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  U: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
}
const LOGO = 'CLAUDLE'
const LOGO_RAMP = [0xf4c09f, 0xeea27d, 0xd97757, 0xd97757, 0xb4533f]

export function logoWidth(scale: number): number {
  return LOGO.length * 4 * scale - scale
}

function drawLogo(c: Canvas, x: number, y: number, scale: number, t: number) {
  // a highlight sweeps across the letters every few seconds
  const sweep = ((t % 4800) / 4800) * (logoWidth(scale) + 80) - 20
  ;[...LOGO].forEach((letter, i) => {
    const glyph = FONT[letter]!
    for (let r = 0; r < 5; r++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[r]![col] !== '#') continue
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = x + (i * 4 + col) * scale + dx
            const py = y + r * scale + dy
            c.set(px + 1, py + 1, P.wine)
            const shine = Math.abs(px - sweep - (py - y)) < 2
            c.set(px, py, shine ? 0xffe2cf : LOGO_RAMP[Math.min(4, Math.floor(((r * scale + dy) / (5 * scale)) * 5))]!)
          }
        }
      }
    }
  })
}

// ── Quizmaster Claude ──────────────────────────────────────────────────

type Face = 'ahead' | 'blink' | 'happy' | 'sad' | 'focused' | 'confused' | 'squint'
type ArmPose = 'down' | 'mid' | 'up'
const TINT = { h: 0xeea27d, O: 0xd97757, s: 0xb4533f, E: P.ink, w: P.white, b: P.ink, r: P.red }

const FACES: Record<Face, [number, number, 'E' | 's'][]> = {
  ahead: [[1, 3, 'E'], [2, 3, 'E'], [1, 7, 'E'], [2, 7, 'E']],
  blink: [[2, 3, 's'], [2, 7, 's']],
  happy: [[1, 3, 'E'], [2, 2, 'E'], [2, 4, 'E'], [1, 7, 'E'], [2, 6, 'E'], [2, 8, 'E']],
  sad: [[2, 3, 'E'], [3, 3, 'E'], [2, 7, 'E'], [3, 7, 'E'], [1, 4, 's'], [1, 6, 's']],
  focused: [[2, 3, 'E'], [2, 4, 'E'], [2, 6, 'E'], [2, 7, 'E']],
  confused: [[1, 3, 'E'], [2, 3, 'E'], [2, 7, 'E'], [2, 8, 'E'], [0, 8, 's']],
  squint: [[2, 3, 'E'], [2, 4, 'E'], [2, 7, 'E'], [2, 8, 'E']],
}

/** Claude, 11 by 7: the comic's figure. */
function claude(face: Face, back: ArmPose, front: ArmPose, step: number): string[] {
  const grid = ['..OOOOOOO..', '..OOOOOOO..', '..OOOOOOO..', '..OOOOOOO..', '..sssssss..'].map(r => r.split(''))
  const arm = (state: ArmPose, [inner, outer]: [number, number]) => {
    const row = state === 'down' ? 2 : 1
    grid[row]![inner] = 'O'
    grid[state === 'up' ? 0 : row]![outer] = 'O'
  }
  arm(back, [1, 0])
  arm(front, [9, 10])
  for (const [r, col, ch] of FACES[face]) grid[r]![col] = ch
  for (let col = 0; col <= 7; col++) if (grid[0]![col] === 'O') grid[0]![col] = 'h'
  for (let r = 1; r <= 2; r++) if (grid[r]![2] === 'O') grid[r]![2] = 'h'
  for (let r = 1; r <= 3; r++) if (grid[r]![8] === 'O') grid[r]![8] = 's'
  const legs = step % 2 ? ['..s.s.s.s..', '....s...s..'] : ['..s.s.s.s..', '..s.s.s.s..']

  return [...grid.map(r => r.join('')), ...legs]
}

function scaled(c: Canvas, x: number, y: number, rows: readonly string[], palette: Record<string, number>, scale: number) {
  rows.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      const color = palette[ch]
      if (color !== undefined) c.rect(x + i * scale, y + j * scale, scale, scale, color)
    }),
  )
}

// ── The header scene ───────────────────────────────────────────────────

export type Mood = 'idle' | 'thinking' | 'watching' | 'grading' | 'correct' | 'wrong' | 'confused'

export type Scene = {
  mood: Mood
  /** When the mood began (ms), so a reaction plays once and settles. */
  since: number
  title: string
  xp: number
  /** 0..1 toward the next title, and the XP that title needs (undefined at the top). */
  progress: number
  nextAt: number | undefined
  streak: number
}

const SKY = [0x1b1830, 0x1e1b36, 0x221f3d, 0x262b44]

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453

  return x - Math.floor(x)
}

export function headerRows(columns: number): number {
  return columns >= 78 ? 10 : 6
}

/**
 * Every looping motion of the header repeats within this many ms, so a
 * recorded loop of it (the desktop's SVG) has no seam.
 */
export const PERIOD = 9600
/** How long a reaction (the jump and confetti of a right answer) plays before it settles. */
export const FRESH_MS = 2600

/** One frame of the header at time `t` (ms), as Raster cells. */
export function header(columns: number, scene: Scene, t: number): string {
  return headerCanvas(columns, scene, t).encode()
}

/** One frame of the header at time `t` (ms). */
export function headerCanvas(columns: number, scene: Scene, t: number): Canvas {
  const rows = headerRows(columns)
  const isBig = rows === 10
  const c = new Canvas(columns, rows)
  const h = rows * 2
  const age = t - scene.since

  // night sky, banded, with twinkling stars
  for (let y = 0; y < h; y++) c.rect(0, y, columns, 1, SKY[Math.min(SKY.length - 1, Math.floor((y / h) * SKY.length))]!)
  for (let i = 0; i < Math.floor(columns / 5); i++) {
    const sx = Math.floor(hash(i) * columns)
    const sy = Math.floor(hash(i + 99) * (h - 4))
    const tw = Math.sin((2 * Math.PI * t) / 2400 + i * 1.7)
    if (tw > 0.3) c.set(sx, sy, tw > 0.85 ? P.white : P.steel)
  }

  // the figure on the right, standing on a little stage
  const scale = isBig ? 2 : 1
  const figW = 11 * scale
  const figH = 7 * scale
  const floor = h - (isBig ? 2 : 1)
  const figX = columns - figW - 3
  // a spotlight from above, widening onto the stage
  for (let y = 0; y < floor; y++) {
    const half = Math.round(figW / 2 + 2 + (y / floor) * figW * 0.4)
    const mid = figX + Math.floor(figW / 2)
    c.rect(mid - half, y, half * 2, 1, y % 2 ? 0x2c2850 : 0x2a274c)
  }
  c.rect(figX - 3, floor, figW + 6, h - floor, P.slate)
  c.rect(figX - 3, floor, figW + 6, 1, P.steel)

  let face: Face = 'ahead'
  let back: ArmPose = 'down'
  let front: ArmPose = 'down'
  let lift = 0
  let step = 0
  const isBlink = t % 3200 < 140
  const fresh = age < FRESH_MS
  switch (scene.mood) {
    case 'idle':
      face = isBlink ? 'blink' : 'ahead'
      front = t % PERIOD < 1200 ? 'up' : 'down' // a wave now and then
      break
    case 'watching':
      face = isBlink ? 'blink' : 'focused'
      back = 'mid'
      break
    case 'thinking':
      face = 'squint'
      front = 'mid'
      step = Math.floor(t / 250)
      break
    case 'grading':
      face = 'focused'
      back = 'mid'
      front = 'mid'
      break
    case 'correct':
      face = 'happy'
      back = front = fresh ? 'up' : 'mid'
      lift = fresh ? Math.round(Math.abs(Math.sin(age / 160)) * 3 * scale) : 0
      break
    case 'wrong':
      face = 'sad'
      break
    case 'confused':
      face = 'confused'
      front = 'mid'
      break
  }
  const figY = floor - figH - lift
  scaled(c, figX, figY, claude(face, back, front, step), TINT, scale)

  // what he gives off: thought dots, a question mark, confetti, a rain cloud
  const bx = figX - 5 * scale
  const by = Math.max(0, figY - 2)
  if (scene.mood === 'thinking') {
    const n = Math.floor(t / 300) % 4
    for (let i = 0; i < n; i++) c.rect(bx + i * 2 * scale, by + 2 - i, scale, scale, P.silver)
  } else if (scene.mood === 'grading' || scene.mood === 'confused') {
    const q = ['.ww.', 'w..w', '..w.', '....', '..w.']
    if (Math.floor(t / 500) % 2 === 0) scaled(c, bx, by, q, { w: P.yellow }, 1)
  } else if (scene.mood === 'correct' && fresh) {
    const colors = [P.red, P.amber, P.yellow, P.leaf, P.sky, P.pink, P.white]
    for (let i = 0; i < Math.floor(columns / 2); i++) {
      const x = Math.floor(hash(i * 3) * columns + Math.sin(age / 200 + i) * 2)
      const y = Math.floor(hash(i * 7) * -h + (age / 1000) * (h + 6) * (0.7 + hash(i) * 0.6))
      if (y >= 0 && y < h) c.set(x, y, colors[i % colors.length]!)
    }
  } else if (scene.mood === 'wrong') {
    const cloudX = figX + Math.floor(figW / 2) - 4
    const cloudY = Math.max(0, figY - 5)
    scaled(c, cloudX, cloudY, ['..mmmm..', '.mmmmmm.', 'mmmmmmmm', '.ssssss.'], { m: P.steel, s: P.slate }, 1)
    for (let i = 0; i < 4; i++) {
      const dropY = cloudY + 4 + ((Math.floor(t / 100) + i * 3) % 6)
      if (dropY < figY + 1) c.set(cloudX + 1 + i * 2, dropY, P.sky)
    }
  }

  // the logo, and under it the title, XP bar and streak
  const textBg = SKY[SKY.length - 1]!
  const room = figX - 8 * scale
  const logoRoom = figX - 10
  const logoScale = isBig && logoWidth(2) + 2 <= logoRoom ? 2 : 1
  if (logoWidth(logoScale) + 2 <= logoRoom) drawLogo(c, 2, 2, logoScale, t)
  const textRow = rows - 1
  const barCells = Math.max(6, Math.min(18, room - 30))
  const filled = Math.round(scene.progress * barCells)
  const bar = '█'.repeat(filled) + '░'.repeat(barCells - filled)
  const xpText = scene.nextAt === undefined ? `${scene.xp} XP` : `${scene.xp}/${scene.nextAt} XP`
  let col = 1
  const put = (s: string, fg: number) => {
    if (col + [...s].length > room) return
    c.text(col, textRow, s, fg, textBg)
    col += [...s].length
  }
  put(scene.title + '  ', P.sand)
  put(bar, P.amber)
  put(' ' + xpText, P.mist)
  if (scene.streak > 1) put(`  x${scene.streak} streak`, P.coral)

  return c
}

export { DEFAULT }
