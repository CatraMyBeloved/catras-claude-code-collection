// Speech and thought bubbles, and the "needs you" call: the words wrapped to fit, the bubble set
// beside Claude on whichever side covers the least of the sign boards, a tail toward him.

import type { Canvas } from './canvas'
import { cellWidth } from './canvas'
import { CALL, CLAUDE_WIDTH, SPEECH, THOUGHT } from './sprites'
import { clamp } from './util'

/** A block of cells. */
export type Rect = { left: number; top: number; width: number; height: number }

export type BubbleKind = 'say' | 'think' | 'call'
export type Bubble = Rect & {
  kind: BubbleKind
  lines: string[]
  /** The row its tail joins Claude on. */
  link: number
  side: 'right' | 'left' | 'above'
}

/** How many cells two blocks share. */
export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

/** The cells a bubble covers, its tail to Claude included. */
export function bubbleRect(b: Bubble): Rect {
  return { left: b.left - 2, top: b.top, width: b.width + 4, height: b.height }
}

/** Words wrapped to lines of at most `width` cells; a word longer than a line is cut short. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = cellWidth(word) > width ? [...word].slice(0, width - 1).join('') + '…' : word
    if (!line) line = w
    else if (cellWidth(line) + 1 + cellWidth(w) <= width) line += ' ' + w
    else {
      lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/**
 * Lays a bubble out beside Claude, his left column at `x` and his head on `headRow`: the narrowest
 * bubble that holds the whole remark (else the widest, ellipsized), on the side that covers the
 * least of `avoid`; above him when neither side has room.
 */
export function layoutBubble(
  text: string,
  kind: BubbleKind,
  at: { x: number; headRow: number; columns: number; rows: number },
  avoid: readonly Rect[],
): Bubble {
  const { headRow, columns, rows } = at
  const maxInner = clamp(columns - CLAUDE_WIDTH - 8, 10, 40)
  const maxLines = clamp(rows - 3, 1, 4)
  let inner = Math.min(maxInner, 26)
  let lines = wrap(text, inner)
  while (lines.length > maxLines && inner < maxInner) {
    inner = Math.min(maxInner, inner + 4)
    lines = wrap(text, inner)
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    const last = lines[maxLines - 1]!
    lines[maxLines - 1] = (cellWidth(last) >= inner ? [...last].slice(0, inner - 1).join('') : last) + '…'
  }
  const width = Math.max(...lines.map(cellWidth)) + 4
  const height = lines.length + 2
  const top = clamp(headRow - height + 3, 0, Math.max(0, rows - height))
  const link = clamp(headRow + 1, top + 1, top + height - 2)
  const x = Math.round(at.x)

  const sides: Bubble[] = []
  if (x + CLAUDE_WIDTH + 2 + width <= columns) sides.push({ kind, lines, width, height, top, link, side: 'right', left: x + CLAUDE_WIDTH + 2 })
  if (x - 2 - width >= 0) sides.push({ kind, lines, width, height, top, link, side: 'left', left: x - 2 - width })
  if (!sides.length) sides.push({ kind, lines, width, height, top: 0, link, side: 'above', left: clamp(x - Math.floor(width / 2), 0, Math.max(0, columns - width)) })
  const cost = (b: Bubble) => avoid.reduce((sum, r) => sum + overlap(bubbleRect(b), r), 0)
  return sides.reduce((best, b) => (cost(b) < cost(best) ? b : best))
}

export function drawBubble(c: Canvas, b: Bubble) {
  const style = b.kind === 'say' ? SPEECH : b.kind === 'call' ? CALL : THOUGHT
  c.box(b.left, b.top, b.lines, style.fg, style.bg, style.border)
  // a speech tail is a line to him; a thought's is a little circle
  if (b.side === 'right') {
    if (b.kind !== 'think') {
      c.text(b.left, b.link, '┤', style.border, style.bg)
      c.text(b.left - 2, b.link, '──', style.border)
    } else c.text(b.left - 1, b.link, 'o', style.border)
  } else if (b.side === 'left') {
    if (b.kind !== 'think') {
      c.text(b.left + b.width - 1, b.link, '├', style.border, style.bg)
      c.text(b.left + b.width, b.link, '──', style.border)
    } else c.text(b.left + b.width, b.link, 'o', style.border)
  }
}
