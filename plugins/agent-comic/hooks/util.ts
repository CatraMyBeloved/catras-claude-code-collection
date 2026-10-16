// Small numeric helpers shared across the comic.

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** A fixed pseudo-random value in [0, 1) for `n`: scenery that looks scattered but never moves. */
export function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return s - Math.floor(s)
}
