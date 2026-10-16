// How long things take on stage: the pace, each beat's length, and the breath after it.

import type { Beat } from './scene'
import { clamp } from './util'

/** How busy the stage is: walk speed (columns a second), and how long the rests between actions last. */
export type Pace = { walk: number; rest: number }
export const PACES: Record<'calm' | 'normal' | 'lively', Pace> = {
  calm: { walk: 9, rest: 1 },
  normal: { walk: 12, rest: 0.6 },
  lively: { walk: 15, rest: 0.3 },
}
/** A run (or a sprint for the door) is this much faster than a walk. */
export const RUN_FACTOR = 2.4

/** Seconds of the handling beats once he stands at their prop: the phases `Stage.play` goes through. */
export const LOOK_SECS = 1.8
export const LIFT_SECS = 0.4 // lifting a prop overhead (carry, transform)
export const HOP_SECS = 0.6 // the hop onto a prop to squash it
export const TYPE_SECS = 2.5
export const HAMMER_SECS = 2.4 // a sign hammered in, its board typed onto it
const TRAVEL_SECS = 6 // a door summoned, walked to, gone through
/** The whole handling of each beat, for the stage's estimates (the walk to the prop comes on top). */
const HANDLING_SECS: Partial<Record<Beat['do'], number>> = {
  look: LOOK_SECS, squash: HOP_SECS, carry: LIFT_SECS, transform: 2.1, plant_sign: HAMMER_SECS, pull_sign: 2.1, travel: TRAVEL_SECS,
}

/** How long a remark stays up: longer for more words, within reason. */
export function sayTime(text: string): number {
  return clamp(2.5 + text.length * 0.07, 3.5, 9)
}

/**
 * How long a beat plays where he stands (s). Undefined for the beats that end when what they do is
 * done: a walk or run on arrival, a handling beat once its prop is handled.
 */
export function heldSecs(b: Beat): number | undefined {
  switch (b.do) {
    case 'say':
    case 'think': return b.secs ?? sayTime(b.text)
    case 'read': return b.secs ?? 3
    case 'emote': return b.secs ?? 3.5
    case 'ponder': return b.secs ?? 3
    case 'dance': return b.secs ?? 2.5
    case 'dig': return b.secs ?? 2
    case 'wait': return b.secs
    case 'drop': return 0.4
    case 'wave': return 1.6
    case 'shrug': return 1.3
    case 'jump': return 0.6
    case 'celebrate': return 1.6
    case 'hat': return 1.4
    default: return undefined
  }
}

/** About how long a handling beat takes once he is at its prop (s); 0 for any other beat. */
export function handlingSecs(b: Beat): number {
  return b.do === 'type' ? b.secs ?? TYPE_SECS : HANDLING_SECS[b.do] ?? 0
}

/** Seconds of stillness after a beat, in ms: the "put it down, take a breath" between actions. */
export function restAfter(beat: Beat, jitter: number): number {
  const base: Partial<Record<Beat['do'], number>> = {
    carry: 1.6, drop: 1.6, squash: 1.6, transform: 1.8, plant_sign: 1.6, pull_sign: 1.6, look: 1.2, dig: 1.4, type: 1.4,
    say: 1.0, think: 1.0, emote: 0.8, walk: 0.6, run: 0.8,
    ponder: 0.4, wait: 0.3, hat: 1.0,
  }
  return ((base[beat.do] ?? 1.0) + jitter * 0.6) * 1000
}
