// A small pixel painter for a Raster: two pixels to a cell (half blocks), and text on top.
// The same cell format the comic draws with, so a place looks like part of the same band.

export const NONE = 0x01000000 // the terminal's own colour: nothing painted

export class Paint {
  private readonly px: Uint32Array
  private readonly text = new Map<number, { cp: number; fg: number; bg: number }>()

  constructor(readonly columns: number, readonly rows: number) {
    this.px = new Uint32Array(columns * rows * 2).fill(NONE)
  }

  set(x: number, y: number, color: number) {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows * 2) return
    this.px[y * this.columns + x] = color
  }

  rect(x: number, y: number, w: number, h: number, color: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color)
  }

  /** Rows of palette letters, '.' transparent; `flip` mirrors it (the kit's art faces right). */
  sprite(x: number, y: number, rows: readonly string[], palette: Record<string, number>, flip = false) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const color = palette[row[flip ? row.length - 1 - i : i]!]
        if (color !== undefined) this.set(x + i, y + j, color)
      }
    })
  }

  /** Text in cell `row`, one character to a cell. */
  write(col: number, row: number, s: string, fg: number, bg = NONE) {
    let i = 0
    for (const ch of s) {
      const c = col + i++
      if (c >= 0 && c < this.columns && row >= 0 && row < this.rows) this.text.set(row * this.columns + c, { cp: ch.codePointAt(0)!, fg, bg })
    }
  }

  /** A Raster's `cells`: base64 of [codePoint, fg, bg] u32 triplets, row by row. */
  encode(): string {
    const out = new Uint32Array(this.columns * this.rows * 3)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        const cell = r * this.columns + c
        const top = this.px[2 * r * this.columns + c]!
        const bottom = this.px[(2 * r + 1) * this.columns + c]!
        const t = this.text.get(cell)
        const [cp, fg, bg] = t ? [t.cp, t.fg, t.bg === NONE ? bottom : t.bg]
          : top === bottom ? [0x20, top, top]
          : top === NONE ? [0x2584, bottom, NONE]
          : [0x2580, top, bottom]
        out.set([cp, fg, bg], cell * 3)
      }
    }
    return base64(new Uint8Array(out.buffer))
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}
