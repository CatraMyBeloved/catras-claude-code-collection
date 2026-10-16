// What the dev scripts share: a seeded random source, so every run draws the same frames, and scenes
// written as plain objects, held to the scene language as the director's are.

import { parseScene } from '../hooks/scene'
import type { Scene } from '../hooks/scene'

/** A small deterministic PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A scene that sets up a world of its own. */
export function scene(raw: object): Scene {
  const s = parseScene(JSON.stringify(raw))
  if ('error' in s) throw new Error(s.error)
  return s
}

/** A director's scene in an existing world, so its world-changing beats (hat, transform, travel) are kept. */
export function directed(raw: { setting: Scene['setting']; hat: Scene['hat']; props: Scene['props']; beats: object[] }): Scene {
  const s = parseScene(JSON.stringify(raw), { setting: raw.setting, props: raw.props }, { changes: 'director' })
  if ('error' in s) throw new Error(s.error)
  return { ...s, continues: undefined, hat: raw.hat }
}
