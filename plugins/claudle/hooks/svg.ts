// The pixel art as SVG, for surfaces that draw no Raster (the desktop app).
// The same Canvas the terminal draws: one SVG unit per pixel (a terminal cell is
// one unit wide and two tall), the text layer on top. The header's animation is
// recorded as frames that differ from the first and flipped through with SMIL.

import type { GameId } from '../types'
import { FRESH_MS, headerCanvas, headerRows, iconCanvas, PERIOD } from './art'
import type { Scene } from './art'
import { Canvas, DEFAULT } from './canvas'

/** CSS pixels per terminal column at the markup's own size. */
const UNIT = 8
/** The Svg element takes at most this much markup; stay clear of it. */
const BUDGET = 120_000

const color = (c: number) => `#${c.toString(16).padStart(6, '0')}`

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Rects for every pixel `pick` keeps, merged into horizontal runs of one color. */
function runs(c: Canvas, pick: (x: number, y: number, color: number) => boolean): string {
  let out = ''
  for (let y = 0; y < c.height; y++) {
    let x = 0
    while (x < c.columns) {
      const v = c.px[y * c.columns + x]!
      if (v === DEFAULT || !pick(x, y, v)) {
        x++
        continue
      }
      let end = x + 1
      while (end < c.columns && c.px[y * c.columns + end] === v && pick(end, y, v)) end++
      out += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${color(v)}"/>`
      x = end
    }
  }

  return out
}

/** The text layer: each run of cells with one style as one <text>, its box behind it. */
function texts(c: Canvas): string {
  let out = ''
  for (let r = 0; r < c.rows; r++) {
    let col = 0
    while (col < c.columns) {
      const at = r * c.columns + col
      if (!c.glyph[at]) {
        col++
        continue
      }
      const fg = c.fg[at]!
      const bg = c.bg[at]!
      let end = col + 1
      while (end < c.columns && c.glyph[r * c.columns + end] && c.fg[r * c.columns + end] === fg && c.bg[r * c.columns + end] === bg) end++
      const chars = Array.from(c.glyph.slice(at, r * c.columns + end), cp => String.fromCodePoint(cp)).join('')
      if (bg !== DEFAULT) out += `<rect x="${col}" y="${r * 2}" width="${end - col}" height="2" fill="${color(bg)}"/>`
      if (chars.trim() !== '') {
        out +=
          `<text x="${col}" y="${r * 2 + 1.55}" textLength="${end - col}" lengthAdjust="spacingAndGlyphs"` +
          ` fill="${color(fg === DEFAULT ? 0xdddddd : fg)}">${escape(chars)}</text>`
      }
      col = end
    }
  }

  return out
}

function wrap(c: Canvas, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.columns} ${c.height}"` +
    ` width="${c.columns * UNIT}" height="${c.height * UNIT}" shape-rendering="crispEdges">` +
    `<style>text{font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:1.6px;white-space:pre}</style>` +
    body +
    '</svg>'
  )
}

/** A still canvas (a game icon) as SVG. */
export function canvasSvg(c: Canvas): string {
  return wrap(c, runs(c, () => true) + texts(c))
}

export function iconSvg(id: GameId): string {
  return canvasSvg(iconCanvas(id))
}

/** What differs in `frame` from `base`, as rects in the frame's colors. */
function diff(base: Canvas, frame: Canvas): string {
  return runs(frame, (x, y, v) => base.px[y * base.columns + x] !== v)
}

/** A group shown from `begin` for `dur` ms, once. */
const once = (body: string, begin: number, dur: number) =>
  `<g visibility="hidden">${body}<set attributeName="visibility" to="visible" begin="${begin}ms" dur="${dur}ms"/></g>`

/** A group shown for the `i`th of `n` slots of a loop of `loop` ms, forever from `begin`. */
function looped(body: string, i: number, n: number, loop: number, begin: number): string {
  const values: string[] = []
  const times: number[] = []
  const add = (v: string, t: number) => {
    if (values.at(-1) === v) return
    values.push(v)
    times.push(t)
  }
  add(i === 0 ? 'visible' : 'hidden', 0)
  if (i > 0) add('visible', i / n)
  if (i + 1 < n) add('hidden', (i + 1) / n)
  const anim =
    `<animate attributeName="visibility" values="${values.join(';')}" keyTimes="${times.map(t => +t.toFixed(5)).join(';')}"` +
    ` calcMode="discrete" dur="${loop}ms" begin="${begin}ms" repeatCount="indefinite"/>`

  return `<g visibility="hidden">${body}${anim}</g>`
}

/**
 * The animated header as of `now`: a reaction still under way plays its rest
 * once, then the settled mood loops. The frame rate drops until it fits.
 */
export function headerSvg(columns: number, scene: Scene, now: number): string {
  const age = now - scene.since
  const introLeft = scene.mood === 'correct' ? Math.max(0, FRESH_MS - age) : 0
  for (const step of [100, 150, 200, 300, 400, 600, 800]) {
    const base = headerCanvas(columns, scene, now)
    let body = runs(base, () => true)
    for (let t = step; t < introLeft; t += step) body += once(diff(base, headerCanvas(columns, scene, now + t)), t, step)
    // the loop starts where the reaction ends; its own time keeps the periodic motions in phase
    const loopStart = now + introLeft
    const n = Math.round(PERIOD / step)
    for (let i = 0; i < n; i++) {
      const frame = headerCanvas(columns, scene, loopStart + i * step)
      const changed = diff(base, frame)
      if (changed !== '') body += looped(changed, i, n, PERIOD, introLeft)
    }
    const svg = wrap(base, body + texts(base))
    if (svg.length <= BUDGET) return svg
  }

  return canvasSvg(headerCanvas(columns, scene, now))
}

let settledSvg: { key: string; svg: string } | undefined

/**
 * `headerSvg`, but once no reaction is under way the markup no longer
 * depends on the clock: every redraw sends the same SVG, so the desktop
 * keeps its frame (no reload, no restarted animation) and nothing is redrawn
 * from scratch. The loop's phase is the frame's own, which nobody can see.
 */
export function stableHeaderSvg(columns: number, scene: Scene, now: number): string {
  if (scene.mood === 'correct' && now - scene.since < FRESH_MS) return headerSvg(columns, scene, now)
  // as of time 0, a reaction that began FRESH_MS earlier is already over
  const settled = { ...scene, since: -FRESH_MS }
  const key = JSON.stringify([columns, settled])
  if (settledSvg?.key !== key) settledSvg = { key, svg: headerSvg(columns, settled, 0) }

  return settledSvg.svg
}

/** The markup's own size in CSS pixels. */
export function headerPixels(columns: number): { width: number; height: number } {
  return { width: columns * UNIT, height: headerRows(columns) * 2 * UNIT }
}
