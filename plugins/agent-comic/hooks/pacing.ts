// When to ask the director for the next scene, and how long each step took on the way to the screen.

import type { Stamp } from './scene'

/** Per pace: the least time between two requests, and how quiet a turn must be before an interlude. */
export const TIMING = {
  calm: { minGapMs: 10000, quietMs: 6000 },
  normal: { minGapMs: 8000, quietMs: 5000 },
  lively: { minGapMs: 6000, quietMs: 4000 },
}
export const MAX_INTERLUDES = 4 // per quiet stretch; the last one sends Claude to sleep
const LEAD_MS = 1500 // a scene should land a little before the stage runs dry, not just after
const INTERLUDE_GAP_MS = 6000

export type AskState = {
  now: number
  pace: keyof typeof TIMING
  /** Log lines not staged yet. */
  fresh: number
  lastAsk: number
  lastActivity: number
  isTurnRunning: boolean
  isWrapPending: boolean
  /** True until the turn's first scene has set up its world. */
  isWorldless: boolean
  interludes: number
  /** What the stage has left to play, playing and queued (Stage.remainingMs). */
  remainingMs: number
  /** How soon a scene of news would get on stage (Stage.untilFreeMs). */
  untilFreeMs: number
  /** How long the director usually takes to answer. */
  latencyMs: number
}

/**
 * What to ask for now, if anything. A scene is asked for about when the stage will
 * run dry, so it is ready as the current one ends instead of waiting in line behind it.
 */
export function nextAsk(s: AskState): 'wrap' | 'scene' | 'interlude' | null {
  if (s.isWrapPending) return 'wrap'
  const t = TIMING[s.pace]
  const isAhead = (ms: number) => ms <= s.latencyMs + LEAD_MS
  if (s.fresh > 0) {
    // the turn's first scene sets up the world: it is the slowest to stage, so it goes at once
    if (s.now - s.lastAsk < t.minGapMs) return null
    // news may end the playing scene at a pause, so it is timed to that pause, not to the scene's end
    return isAhead(s.untilFreeMs) || (s.isWorldless && s.isTurnRunning) ? 'scene' : null
  }
  const isQuiet = s.isTurnRunning && s.now - s.lastActivity >= t.quietMs && s.now - s.lastAsk >= INTERLUDE_GAP_MS
  // an interlude carries the story on: it waits for the current scene to play out
  return isQuiet && isAhead(s.remainingMs) && s.interludes < MAX_INTERLUDES ? 'interlude' : null
}

/** A rolling estimate of the director's answer time: recent calls count most. */
export function blendLatency(current: number, measured: number): number {
  return Math.round(current * 0.7 + measured * 0.3)
}

/** One played scene's way to the screen (ms). */
export type SceneTiming = {
  kind: Stamp['kind']
  waitMs?: number
  modelMs: number
  queueMs: number
  totalMs?: number
  expectedLeftMs: number
  /** What the stage really had left when it was asked: from the request to the scene's start. */
  actualLeftMs: number
}

const KEEP_RECENT = 8

export type Timings = { scenes: number; staged: number; waitMs: number; modelMs: number; queueMs: number; totalMs: number; recent: SceneTiming[] }

export const emptyTimings = (): Timings => ({ scenes: 0, staged: 0, waitMs: 0, modelMs: 0, queueMs: 0, totalMs: 0, recent: [] })

/** Adds a scene that just began to play. `staged` counts the ones that stage real activity (not interludes). */
export function addTiming(t: Timings, stamp: Stamp, playedAt: number): Timings {
  const hasActivity = stamp.activity !== undefined
  const row: SceneTiming = {
    kind: stamp.kind,
    waitMs: hasActivity ? stamp.asked - stamp.activity! : undefined,
    modelMs: stamp.answered - stamp.asked,
    queueMs: playedAt - stamp.answered,
    totalMs: hasActivity ? playedAt - stamp.activity! : undefined,
    expectedLeftMs: stamp.expectedLeftMs,
    actualLeftMs: playedAt - stamp.asked,
  }
  return {
    scenes: t.scenes + 1,
    staged: t.staged + (hasActivity ? 1 : 0),
    waitMs: t.waitMs + (row.waitMs ?? 0),
    modelMs: t.modelMs + row.modelMs,
    queueMs: t.queueMs + row.queueMs,
    totalMs: t.totalMs + (row.totalMs ?? 0),
    recent: [...t.recent, row].slice(-KEEP_RECENT),
  }
}

export function formatTimings(t: Timings, latencyMs: number, asked: number): string {
  if (t.scenes === 0) return 'Latency: no director scene has played yet this session.'
  const s = (ms: number, n: number) => (n ? `${(ms / n / 1000).toFixed(1)}s` : 'n/a')
  const one = (ms: number | undefined) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1)}s`)
  return [
    `Latency, averaged over ${t.scenes} scenes this session (${asked - t.scenes} more still queued or dropped):`,
    '',
    '| activity → request | request → answer | answer → on stage | activity → on stage |',
    '|---|---|---|---|',
    `| ${s(t.waitMs, t.staged)} | ${s(t.modelMs, t.scenes)} | ${s(t.queueMs, t.scenes)} | ${s(t.totalMs, t.staged)} |`,
    '',
    `The last ${t.recent.length} scenes, oldest first ("stage left": what the stage expected to have left when asked, and what it really had):`,
    '',
    '| scene | activity → request | request → answer | answer → on stage | activity → on stage | stage left: expected / real |',
    '|---|---|---|---|---|---|',
    ...t.recent.map(r =>
      `| ${r.kind} | ${one(r.waitMs)} | ${one(r.modelMs)} | ${one(r.queueMs)} | ${one(r.totalMs)} | ${one(r.expectedLeftMs)} / ${one(r.actualLeftMs)} |`),
    '',
    `Requests go out when the stage has about ${(latencyMs / 1000).toFixed(1)}s left to play (the director's recent answer time).`,
  ].join('\n')
}
