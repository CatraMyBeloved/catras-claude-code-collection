// Props on the ground: how wide each one is, where one fits beside the others, and how it is drawn.
// A sign is a post with a board of its label; every other prop is a sprite, its label above it.

import type { Canvas } from './canvas'
import { cellWidth } from './canvas'
import { overlap } from './bubble'
import type { Rect } from './bubble'
import type { Prop } from './scene'
import { FLAG_WAVE, P, PROPS, SIGN } from './sprites'
import { clamp } from './util'

/** The columns something takes: from `[0]` up to, not including, `[1]`. */
export type Span = [number, number]

/** Columns kept clear between two props. */
const GAP = 2

/** How a sign moves while it is hammered in, wobbled loose or pulled out. */
export type SignMotion = { kind: 'grow' | 'shake' | 'rise'; start: number; ms: number }

/** A sign's board: its label, a space either side and the border. */
export const signWidth = (label: string | undefined): number => cellWidth(label ?? '?') + 4

export function propWidth(prop: Prop): number {
  return prop.kind === 'sign' ? signWidth(prop.label) : PROPS[prop.kind].rows[0]!.length
}

/** The columns a prop takes at `col`: its sprite or board, and any label above it. */
export function propSpan(prop: Prop, col: number): Span {
  const width = propWidth(prop)
  if (prop.kind === 'sign' || !prop.label) return [col, col + width]
  const label = cellWidth(prop.label)
  const labelLeft = col + Math.floor(width / 2) - Math.floor(label / 2)
  return [Math.min(col, labelLeft), Math.max(col + width, labelLeft + label)]
}

/** The board of a sign standing at `col` on a band `rows` tall, in cells. */
export function signBoard(prop: Prop, col: number, rows: number): Rect {
  return { left: col, top: Math.max(0, rows - 6), width: signWidth(prop.label), height: 3 }
}

/**
 * The nearest column to `want` where `prop` keeps clear of every span in `others`, or null when the
 * band (`columns` wide) is too full for that.
 */
export function freeCol(prop: Prop, want: number, columns: number, others: readonly Span[]): number | null {
  const [l0, r0] = propSpan(prop, 0)
  const fits = (col: number) => {
    const [l, r] = [l0 + col, r0 + col]
    if (l < 0 || r > columns) return false
    return others.every(([ol, or]) => r + GAP <= ol || or + GAP <= l)
  }
  for (let d = 0; d <= columns; d++) {
    if (fits(want + d)) return want + d
    if (fits(want - d)) return want - d
  }
  return null
}

/** Where `prop` overlaps `others` the least, nearest `want` among equals: for when nothing is free. */
export function leastCrowdedCol(prop: Prop, want: number, columns: number, others: readonly Span[]): number {
  const [l0, r0] = propSpan(prop, 0)
  let best = clamp(want, 0, Math.max(0, columns - (r0 - l0)))
  let bestCost = Infinity
  for (let col = -l0; col + r0 <= columns; col++) {
    const cost = others.reduce((sum, [ol, or]) => sum + Math.max(0, Math.min(r0 + col, or) - Math.max(l0 + col, ol)), 0)
    if (cost < bestCost || (cost === bestCost && Math.abs(col - want) < Math.abs(best - want))) {
      best = col
      bestCost = cost
    }
  }
  return best
}

/** What a prop's drawing depends on beyond the prop itself. */
export type PropLook = {
  now: number
  /** A sign on the move: hammered in, wobbled loose, pulled out. */
  motion?: SignMotion
  /** Claude is typing: computers' cursors race. */
  isTyping: boolean
  /** What a bubble covers this frame: a sign board it would cut into is left out. */
  bubble: Rect | null
}

/** Draws a prop at column `col`, standing on pixel row `ground`. */
export function drawProp(c: Canvas, prop: Prop, col: number, ground: number, look: PropLook) {
  if (prop.kind === 'sign') drawSign(c, prop.label ?? '?', col, ground, look)
  else drawThing(c, prop, col, ground, look)
}

function drawSign(c: Canvas, label: string, col: number, ground: number, { now, motion, bubble }: PropLook) {
  const length = cellWidth(label)
  const width = length + 4
  const m = motion ? Math.min(1, (now - motion.start) / motion.ms) : 1
  // shaken loose: a one-column wobble; pulled out: the whole sign lifts two rows
  if (motion?.kind === 'shake') col += Math.floor(now / 90) % 2 ? 1 : -1
  const rise = motion?.kind === 'rise' ? Math.round(m * 2) : 0
  const boxTop = Math.max(0, Math.floor(ground / 2) - 5) - rise
  const post = col + Math.floor(width / 2) - 1
  const postTop = (boxTop + 3) * 2
  const postBottom = ground - rise * 2
  // hammered in: the post grows out of the ground blow by blow, then the board types itself in
  const grow = motion?.kind === 'grow' ? m : 1
  const shown = Math.ceil(grow * (postBottom - postTop))
  for (let y = postBottom - shown; y < postBottom; y++) {
    c.set(post, y, P.wood)
    c.set(post + 1, y, P.bark)
  }
  const board = { left: col, top: boxTop, width, height: 3 }
  if (grow < 0.5 || (bubble && overlap(board, bubble))) return
  const typed = [...label].slice(0, Math.ceil(((grow - 0.5) / 0.5) * length)).join('')
  c.box(col, boxTop, [typed + ' '.repeat(length - cellWidth(typed))], SIGN.fg, SIGN.bg, SIGN.border)
}

function drawThing(c: Canvas, prop: Prop, col: number, ground: number, { now, isTyping }: PropLook) {
  if (prop.kind === 'sign') return
  const rows = prop.kind === 'flag' && Math.floor(now / 400) % 2 === 1 ? FLAG_WAVE : PROPS[prop.kind].rows
  const top = ground - rows.length
  c.sprite(col, top, rows, PROPS[prop.kind].palette)
  if (prop.kind === 'computer') {
    // the cursor: a slow blink, racing along the line while he types
    if (Math.floor(now / (isTyping ? 120 : 500)) % 2 === 0) c.set(col + (isTyping ? 2 + Math.floor(now / 240) % 4 : 5), top + 2, P.leaf)
  }
  // the label goes above a prop on the ground, not one held overhead
  if (prop.label && ground === c.height - 2) {
    const row = Math.max(0, Math.floor(top / 2) - 1)
    c.text(col + Math.floor(propWidth(prop) / 2) - Math.floor(cellWidth(prop.label) / 2), row, prop.label, P.mist)
  }
}
