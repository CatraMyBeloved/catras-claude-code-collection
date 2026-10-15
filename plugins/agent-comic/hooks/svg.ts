// The comic for surfaces that draw no Raster (the desktop app, VS Code): a chunk of
// frames as one SVG that plays itself. One SVG unit per pixel (a terminal cell is one
// unit wide and two tall). Pixels that stay the same through the whole chunk are drawn
// once; every pixel that changes at any point belongs to each frame's own layer, shown
// only for that frame's slot. Layers never stack, so a pixel that turns transparent
// (the terminal's own background, where the sky is left open) is simply not drawn in
// that frame instead of keeping an earlier frame's color: no smearing. Text (bubbles,
// captions, signs) is a layer of its own per stretch of frames that show the same words.

import { Canvas, DEFAULT } from './canvas'

/** CSS pixels per terminal column at the markup's own size. */
const UNIT = 8
/** The Svg element takes at most 131072 characters; stay clear of it. */
export const SVG_BUDGET = 120_000

const color = (c: number) => `#${c.toString(16).padStart(6, '0')}`

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Rects for every pixel `pick` keeps, merged into horizontal runs of one color. */
function runs(c: Canvas, pick: (at: number, color: number) => boolean): string {
  let out = ''
  for (let y = 0; y < c.height; y++) {
    let x = 0
    while (x < c.columns) {
      const at = y * c.columns + x
      const v = c.px[at]!
      if (v === DEFAULT || !pick(at, v)) {
        x++
        continue
      }
      let end = x + 1
      while (end < c.columns && c.px[y * c.columns + end] === v && pick(y * c.columns + end, v)) end++
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
      while (
        end < c.columns &&
        c.glyph[r * c.columns + end] &&
        c.fg[r * c.columns + end] === fg &&
        c.bg[r * c.columns + end] === bg
      ) {
        end++
      }
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

/** One frame, still. */
export function stillSvg(c: Canvas): string {
  return wrap(c, runs(c, () => true) + texts(c))
}

/** A layer on from `begin` for `dur` ms, or for good when `dur` is undefined. */
const during = (body: string, begin: number, dur: number | undefined) =>
  begin === 0 && dur === undefined
    ? `<g>${body}</g>`
    : `<g visibility="${begin === 0 ? 'visible' : 'hidden'}">${body}` +
      (begin === 0 ? '' : `<set attributeName="visibility" to="visible" begin="${begin}ms"/>`) +
      (dur === undefined ? '' : `<set attributeName="visibility" to="hidden" begin="${begin + dur}ms"/>`) +
      '</g>'

/**
 * Frames `stepMs` apart as one SVG that plays them once and holds the last.
 * Undefined when it does not fit the budget (the caller sends fewer frames).
 */
export function chunkSvg(frames: readonly Canvas[], stepMs: number): string | undefined {
  const first = frames[0]
  if (!first) return undefined
  // which pixels move at all during the chunk
  const moving = new Uint8Array(first.px.length)
  for (const frame of frames) for (let at = 0; at < moving.length; at++) if (frame.px[at] !== first.px[at]) moving[at] = 1
  let pixels = runs(first, at => !moving[at])
  for (let i = 0; i < frames.length; i++) {
    const own = runs(frames[i]!, at => moving[at] === 1)
    if (own !== '') pixels += during(own, i * stepMs, i + 1 < frames.length ? stepMs : undefined)
  }
  // the words: one layer per stretch of frames drawing the same text
  let words = ''
  let start = 0
  let current = texts(first)
  for (let i = 1; i <= frames.length; i++) {
    const next = i < frames.length ? texts(frames[i]!) : undefined
    if (next === current) continue
    if (current !== '') words += during(current, start * stepMs, next === undefined ? undefined : (i - start) * stepMs)
    start = i
    current = next ?? ''
  }
  const svg = wrap(first, pixels + words)

  return svg.length <= SVG_BUDGET ? svg : undefined
}
