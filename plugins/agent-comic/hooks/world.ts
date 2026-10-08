// The session's world: a setting, a hat and a few props, set up by the session's first scene.
// It stays put for the whole session; only the director changes it, now and then, in its scenes:
// a prop transformed, a new hat, or a door into new scenery.

import { cannedProps } from './canned'
import type { Beat, Hat, Prop, Scene, Setting } from './scene'

export type SessionWorld = { setting: Setting; props: Prop[]; hat: Hat }

/** How often the director may change the world in one session: rarely, when the work really shifts. */
export const WORLD_LIMITS = { transform: 6, hat: 4, travel: 2 } as const
export type WorldChangeKind = keyof typeof WORLD_LIMITS
export type WorldChangeCounts = Record<WorldChangeKind, number>

export const noChanges = (): WorldChangeCounts => ({ transform: 0, hat: 0, travel: 0 })

/** What the director may still change this session, for its request. */
export function changesLeft(used: WorldChangeCounts): WorldChangeCounts {
  return {
    transform: Math.max(0, WORLD_LIMITS.transform - used.transform),
    hat: Math.max(0, WORLD_LIMITS.hat - used.hat),
    travel: Math.max(0, WORLD_LIMITS.travel - used.travel),
  }
}

/**
 * Holds a director's scene to the session's limits: world changes past them are dropped, and the
 * ones kept are counted. A hat it already wears is no change; a travel with no props gets fitting ones.
 */
export function limitChanges(scene: Scene, used: WorldChangeCounts, rand: () => number = Math.random): { scene: Scene; used: WorldChangeCounts } {
  const counts = { ...used }
  let hat = scene.hat
  const beats: Beat[] = []
  for (const b of scene.beats) {
    if (b.do === 'transform' || b.do === 'hat' || b.do === 'travel') {
      if (b.do === 'hat' && b.hat === hat) continue
      if (counts[b.do] >= WORLD_LIMITS[b.do]) continue
      counts[b.do]++
      if (b.do === 'hat') hat = b.hat
      if (b.do === 'travel') {
        beats.push(b.props.length ? b : { ...b, props: cannedProps(b.setting, rand) })
        continue
      }
    }
    beats.push(b)
  }
  // a scene left with nothing to do still gives him a moment
  return { scene: { ...scene, beats: beats.length ? beats : [{ do: 'ponder', secs: 2 }] }, used: counts }
}

/**
 * The session's world after the stage reported a change: what played is what the session keeps.
 * `moved`: it is a new place, so the turn's setting and the director's work in flight follow it.
 */
export function followWorld(current: SessionWorld | null, shown: SessionWorld): { world: SessionWorld; moved: boolean } {
  return { world: { ...shown, props: shown.props.map(p => ({ ...p })) }, moved: current !== null && current.setting !== shown.setting }
}
