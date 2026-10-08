// The comic's world beyond the hub: places other plugins add through $.comic, on a ring that
// starts at the hub. Wooden signs at the band's edges lead from one stop to the next.

import type { ComicKit, ComicPlace, ComicSide, ComicStop } from '../types'
import { cellText } from './canvas'
import { clip } from './scene'
import { HATS_ART, P, TINTS, claude } from './sprites'
import { SIGN } from './stage'
import type { Pose } from './sprites'

export const COMIC_VERSION = 1
export const HUB: ComicStop = { id: null, name: 'Hub' }
export const ALIVE_MS = 5000 // a place silent this long has stopped drawing: Claude comes home
const MAX_NAME = 16
const MAX_ID = 64

/** A place as a plugin gave it, made safe to draw; null when it is no place. */
export function asPlace(v: unknown): ComicPlace | null {
  const p = v as { id?: unknown; name?: unknown } | null
  if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') return null
  const id = p.id.trim().slice(0, MAX_ID)
  const name = clip(cellText(p.name.trim()), MAX_NAME)
  return id && name ? { id, name } : null
}

/** The ring with `place` on it (renamed if it was), the hub first, the places by id so signs never jump. */
export function withPlace(ring: readonly ComicStop[], place: ComicPlace): ComicStop[] {
  const places = ring.filter((s): s is ComicPlace => s.id !== null && s.id !== place.id)
  return [HUB, ...[...places, place].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))]
}

/** The ring without the place `id`. */
export function withoutPlace(ring: readonly ComicStop[], id: string): ComicStop[] {
  return [HUB, ...ring.filter(s => s.id !== null && s.id !== id)]
}

/**
 * The signs from `here`: its neighbours on the ring. With the hub alone there are none; with one
 * place, a single sign each way between them, so no stop shows the same sign on both sides.
 */
export function routeOf(ring: readonly ComicStop[], here: string | null): { left: ComicStop | null; right: ComicStop | null } {
  const stops = ring.length ? ring : [HUB]
  const i = Math.max(0, stops.findIndex(s => s.id === here))
  if (stops.length < 2) return { left: null, right: null }
  if (stops.length === 2) return i === 0 ? { left: null, right: stops[1]! } : { left: stops[0]!, right: null }
  return { left: stops[(i - 1 + stops.length) % stops.length]!, right: stops[(i + 1) % stops.length]! }
}

/** The side Claude comes in from after following the sign on side `dir`: the other one. */
export const enteringFrom = (dir: ComicSide): ComicSide => (dir === 1 ? -1 : 1)

/** The comic's art as plain data, for places to draw the same Claude. */
export function kit(): ComicKit {
  const pose = (p: Partial<Pose>): string[] =>
    claude({ face: 'ahead', back: 'down', front: 'down', walk: 0, airborne: false, crouch: false, left: false, ...p })
  return {
    claude: {
      stand: pose({}),
      blink: pose({ face: 'blink' }),
      happy: pose({ face: 'happy', back: 'up', front: 'up' }),
      asleep: pose({ face: 'shut', crouch: true }),
      wave: pose({ face: 'happy', front: 'up' }),
      walk: [0, 1, 2, 3].map(walk => pose({ face: 'right', walk })),
      palette: { ...TINTS.normal },
    },
    hats: Object.fromEntries(Object.entries(HATS_ART).map(([k, h]) => [k, { rows: [...h.rows], palette: { ...h.palette }, sit: h.sit }])),
    sign: { ...SIGN },
    palette: { ...P },
  }
}
