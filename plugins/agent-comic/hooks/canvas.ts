// A pixel canvas two pixels tall per terminal cell (half blocks), with a text
// layer on top, encoded into a Raster's cells.

export const DEFAULT = 0x01000000

const UPPER = 0x2580
const LOWER = 0x2584
const FULL = 0x2588

export class Canvas {
  readonly px: Uint32Array
  readonly glyph: Uint32Array
  readonly fg: Uint32Array
  readonly bg: Uint32Array
  readonly height: number

  constructor(readonly columns: number, readonly rows: number) {
    this.height = rows * 2
    this.px = new Uint32Array(columns * this.height).fill(DEFAULT)
    this.glyph = new Uint32Array(columns * rows)
    this.fg = new Uint32Array(columns * rows)
    this.bg = new Uint32Array(columns * rows)
  }

  set(x: number, y: number, color: number) {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.columns || y >= this.height) return
    // painter's order: a pixel drawn later covers any text drawn into its cell before.
    // It covers only its half, though: the other half keeps the text's background
    // (a sign's board), or the board would show a gap above a figure walking past it.
    const cell = (y >> 1) * this.columns + x
    if (this.glyph[cell]) {
      if (this.bg[cell] !== DEFAULT) this.px[(y ^ 1) * this.columns + x] = this.bg[cell]!
      this.glyph[cell] = 0
    }
    this.px[y * this.columns + x] = color
  }

  rect(x: number, y: number, w: number, h: number, color: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color)
  }

  /** Draws rows of palette letters, '.' transparent; `flip` mirrors it. */
  sprite(x: number, y: number, rows: readonly string[], palette: Record<string, number>, flip = false) {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j]!
      for (let i = 0; i < row.length; i++) {
        const ch = row[flip ? row.length - 1 - i : i]!
        const color = palette[ch]
        if (color !== undefined) this.set(x + i, y + j, color)
      }
    }
  }

  /** Writes text into the cell layer; non-printable or wide characters become '?'. */
  text(col: number, row: number, s: string, fg: number, bg = DEFAULT) {
    col = Math.round(col)
    if (row < 0 || row >= this.rows) return
    let i = 0
    for (const ch of s) {
      const c = col + i++
      if (c < 0 || c >= this.columns) continue
      const at = row * this.columns + c
      this.glyph[at] = safe(ch)
      this.fg[at] = fg
      this.bg[at] = bg
    }
  }

  /** A rounded box around `lines`, top-left at (col, row). */
  box(col: number, row: number, lines: readonly string[], fg: number, bg: number, border: number) {
    const inner = Math.max(...lines.map(l => [...l].length))
    this.text(col, row, '╭' + '─'.repeat(inner + 2) + '╮', border, bg)
    lines.forEach((l, i) => {
      this.text(col, row + 1 + i, '│', border, bg)
      this.text(col + 1, row + 1 + i, ' ' + l.padEnd(inner) + ' ', fg, bg)
      this.text(col + inner + 3, row + 1 + i, '│', border, bg)
    })
    this.text(col, row + lines.length + 1, '╰' + '─'.repeat(inner + 2) + '╯', border, bg)
  }

  /** The Raster `cells`: base64 of [codePoint, fg, bg] u32 triplets, row-major. */
  encode(): string {
    const { columns, rows } = this
    const out = new Uint32Array(columns * rows * 3)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const cell = r * columns + c
        const o = cell * 3
        if (this.glyph[cell]) {
          out[o] = this.glyph[cell]!
          out[o + 1] = this.fg[cell]!
          out[o + 2] = this.bg[cell] === DEFAULT ? this.px[(2 * r + 1) * columns + c]! : this.bg[cell]!
          continue
        }
        const top = this.px[2 * r * columns + c]!
        const bottom = this.px[(2 * r + 1) * columns + c]!
        if (top === DEFAULT && bottom === DEFAULT) {
          out[o] = 0x20; out[o + 1] = DEFAULT; out[o + 2] = DEFAULT
        } else if (top === bottom) {
          out[o] = FULL; out[o + 1] = top; out[o + 2] = DEFAULT
        } else if (top === DEFAULT) {
          out[o] = LOWER; out[o + 1] = bottom; out[o + 2] = DEFAULT
        } else {
          out[o] = UPPER; out[o + 1] = top; out[o + 2] = bottom
        }
      }
    }
    return base64(new Uint8Array(out.buffer))
  }
}

function safe(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0x3f
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp > 0xffff) return 0x3f
  // East Asian wide ranges and emoji draw two cells wide: refuse them here.
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0xd800 && cp <= 0xdfff)) return 0x3f
  return cp
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '='
  }
  return out
}
