// The director: what the agent does each turn goes into a log, and about when the stage runs dry the
// next scene is asked of the model (or, as /config's director setting has it, taken from the canned
// library) and queued on the stage. The session's world is set up by its first scene and carried from
// turn to turn; only the director changes it, within the session's limits.

import type { EngineInterface, ModelUsage } from 'claude-code'

import { weatherAt } from './activity'
import { cannedFirst, cannedInterlude, cannedScene, cannedWrap } from './canned'
import type { Activity } from './canned'
import { cellText } from './canvas'
import { MAX_INTERLUDES, addTiming, blendLatency, emptyTimings, formatTimings, nextAsk } from './pacing'
import { pats } from './pets'
import { SYSTEM, buildPrompt, varietyNotes } from './prompt'
import { settings, stage } from './runtime'
import { clip, parseScene } from './scene'
import type { Scene, Setting, Stamp } from './scene'
import type { StageWorld } from './stage'
import { isEnabled } from './state'
import { addUsage, asTally, emptyTally, formatStats, today } from './usage'
import { changesLeft, followWorld, limitChanges, noChanges } from './world'
import type { SessionWorld } from './world'

const STILL_RUNNING_MS = 4000 // a tool running this long is told to the director before it ends
const LOG_LINES = 40
const RECENT_SCENES = 6 // for the variety notes
const MAX_GOAL = 300

/** The turn under way: what the person asked, and what the agent has done. */
const turn = {
  goal: null as string | null,
  log: [] as string[],
  /** Log lines not staged yet, and when the oldest of them happened. */
  fresh: 0,
  firstFreshAt: undefined as number | undefined,
  lastActivity: 0,
  isRunning: false,
  /** Its first scene is still to be staged: the model stages it, in the session's world. */
  isOpening: false,
  isWrapPending: false,
  /** Interludes asked for since the last new activity. */
  interludes: 0,
  /** What the agent did since the last staged scene, for canned scenes. */
  acts: [] as Activity[],
  /** The agent's latest remark to the person. */
  lastSaid: undefined as string | undefined,
}

/** The session's world: set up by its first scene, then changed only by the director, now and then. */
const session = {
  world: null as SessionWorld | null,
  /** The settings it has been in, oldest first. */
  settings: [] as Setting[],
  /** The stage shows it (not the hub, not the demo's world). */
  isWorldShown: false,
  /** What the director changed of it so far. */
  changes: noChanges(),
}

/** The director's own bookkeeping. */
const desk = {
  /** Bumped by each new turn (and each new place): an answer asked for an older one is dropped. */
  epoch: 0,
  /** The epoch of the request under way, if any. */
  askingIn: null as number | null,
  lastAsk: 0,
  /** Requests in a row that brought no scene, and the back-off after them. */
  failures: 0,
  retryAfter: 0,
  /** While the demo or a /comic-feel plays, the director waits. */
  pausedUntil: 0,
  hasLoggedError: false,
  previous: null as Scene | null,
  recent: [] as Scene[],
  /** The model's recent answer time; the first answers correct it. */
  latencyMs: 7000,
  timings: emptyTimings(),
  tally: emptyTally(),
  /** Scenes the model handed over this session. */
  answered: 0,
}

/** The main thread's tool calls under way, to tell the director about long ones before they end. */
const running = new Map<string, { what: string; since: number; isTold: boolean }>()

/** What a request is for, and what it was asked with. */
type Request = {
  kind: Stamp['kind']
  /** The session's world as the stage has it; none before the session's first scene. */
  world: StageWorld | undefined
  isInterlude: boolean
  isTurnOpening: boolean
  /** The activity it stages, for canned scenes; and the log lines not staged before it. */
  acts: Activity[]
  fresh: number
  /** When its oldest activity happened, and what the stage expected to have left as it was asked. */
  activity: number | undefined
  expectedLeftMs: number
}

/** Sets the director up as the module loads: its first latency guess, and what it learns from the stage. */
export function startDirector() {
  desk.latencyMs = settings.model === 'haiku' ? 4000 : 7000
  stage.onPlay = scene => {
    if (scene.stamp) desk.timings = addTiming(desk.timings, scene.stamp, Date.now())
  }
  // what plays is what the session keeps: a transformed prop, a new hat, new scenery
  stage.onWorldChange = shown => {
    if (!session.isWorldShown || !session.world) return
    const { world, moved } = followWorld(session.world, shown)
    session.world = world
    if (moved) {
      session.settings = [...session.settings, world.setting].slice(-RECENT_SCENES)
      desk.epoch++ // what was being staged for the old place is dropped
    }
  }
}

/** A turn is under way (not the answer to a pat). */
export function isTurnRunning(): boolean {
  return turn.isRunning
}

/** A line for the director's log: new activity. */
export function note(line: string) {
  turn.log.push(line)
  turn.log = turn.log.slice(-LOG_LINES)
  if (turn.fresh === 0) turn.firstFreshAt = Date.now()
  turn.fresh++
  turn.lastActivity = Date.now()
  turn.interludes = 0
}

/** An activity for the canned scenes. */
export function act(a: Activity) {
  turn.acts.push(a)
}

/** The agent said something to the person: the director hears it, and canned scenes may repeat it. */
export function heard(text: string) {
  note(`the agent said: ${text.slice(0, 220)}`)
  turn.lastSaid = clip(cellText(text), 120)
  act({ kind: 'said', text: clip(cellText(text), 60) })
}

/** A main-thread tool call began; a long one is told before it ends. */
export function toolStarted(id: string, what: string) {
  running.set(id, { what, since: Date.now(), isTold: false })
}

export function toolEnded(id: string) {
  running.delete(id)
}

/** A new turn: the person asked for `text`. The session's world carries on; only the first turn sets one up. */
export function beginTurn($: EngineInterface, text: string) {
  stage.attention = null
  desk.epoch++
  desk.retryAfter = 0
  desk.lastAsk = 0
  turn.goal = text.slice(0, MAX_GOAL)
  turn.log = []
  turn.acts = []
  turn.lastSaid = undefined
  turn.fresh = 0
  turn.isWrapPending = false
  turn.isRunning = true
  turn.isOpening = session.world !== null
  note(`the person asked: ${turn.goal}`)
  // something to see at once: at home he heads for the door, elsewhere (idle, or asleep) he stops to think
  const isLeaving = stage.leaveHome()
  // back from home (or the demo): the session's world loads as he steps in, as he left it
  if (session.world && !session.isWorldShown) {
    stage.queue(worldScene(session.world, [{ do: 'ponder', secs: 1.5 }]))
    session.isWorldShown = true
  } else if (!isLeaving && stage.idleMs > 0) stage.interject([{ do: 'ponder', secs: 2 }])
  askSoon($)
}

/** The person added to the running turn: the same story goes on. */
export function addToTurn(text: string) {
  note(`the person added: ${text.slice(0, MAX_GOAL)}`)
}

/**
 * The turn is over. Finished, its wrap-up is asked for at once. Stopped by the person, what was asked
 * for the stopped work is dropped, and a shrug in the turn's world says so (no model needed).
 */
export function endTurn($: EngineInterface, isAborted: boolean) {
  turn.isRunning = false
  stage.attention = null
  if (!isAborted) {
    turn.isWrapPending = true
    askSoon($)
    return
  }
  desk.epoch++
  turn.fresh = 0
  turn.firstFreshAt = undefined
  turn.isWrapPending = false
  turn.acts = []
  if (session.world) stage.queue(cannedWrap(stage.world(), undefined, true, Math.random))
}

/** The director waits `ms` (the demo, a /comic-feel). */
export function pauseFor(ms: number) {
  desk.pausedUntil = Date.now() + ms
}

/** The stage left the session's world (for the demo's); the next turn takes him back to it. */
export function leaveWorld() {
  session.isWorldShown = false
}

/** A /clear is a new conversation: its first turn sets up a new world. */
export function forgetWorld() {
  session.world = null
  session.changes = noChanges()
}

/** /comic-stats: the tokens the director spent, this session and today, and how long its scenes took. */
export async function stats($: EngineInterface): Promise<string> {
  const day = today()
  const tally = asTally(await $.store.get(`usage:${day}`))
  return `${formatStats(settings.model, desk.tally, tally, day)}\n\n${formatTimings(desk.timings, desk.latencyMs, desk.answered)}`
}

/** Once a second: home after a long idle, the sky, and the next scene if it is time to ask for one. */
export async function tick($: EngineInterface) {
  tellRunning()
  const now = Date.now()
  // between turns, a long idle takes him home through the door
  if (!turn.isRunning && stage.wantsHome) {
    stage.goHome()
    session.isWorldShown = false
  }
  stage.ambience = { hour: new Date(now).getHours(), weather: weatherAt(now) }
  if (isAsking() || now < desk.pausedUntil || pats.isAnswering) return
  if (!(await isEnabled($)) || isAsking()) return
  const request = nextRequest(now)
  if (!request) return
  if (isCanned(request.kind, request.isTurnOpening) || now < desk.retryAfter) return stageCanned(request)
  await askModel($, request, now)
}

/** Asks now rather than at the next tick: a new turn, or its end, should not wait a second. */
function askSoon($: EngineInterface) {
  $.clock.after(0, () => tick($).catch(() => undefined))
}

function isAsking(): boolean {
  return desk.askingIn === desk.epoch
}

/** A tool still going after a few seconds (a long build, a test run) is news before its result is. */
function tellRunning() {
  const now = Date.now()
  for (const r of running.values()) {
    if (r.isTold || now - r.since < STILL_RUNNING_MS) continue
    r.isTold = true
    note(`still running, no result yet: ${r.what}`)
  }
}

/** What to ask for now, if anything; asking takes the turn's unstaged activity with it. */
function nextRequest(now: number): Request | null {
  const remainingMs = stage.remainingMs
  const untilFreeMs = stage.untilFreeMs
  const hasWorld = session.world !== null
  // a canned scene is ready at once: it is asked for as the stage runs dry, not a model's latency ahead
  const isCannedNext = isCanned(!hasWorld ? 'first' : turn.isWrapPending ? 'wrap' : 'scene', turn.isOpening) || now < desk.retryAfter
  const ask = nextAsk({
    now, pace: settings.pace, fresh: turn.fresh, lastAsk: desk.lastAsk, lastActivity: turn.lastActivity,
    isTurnRunning: turn.isRunning, isWrapPending: turn.isWrapPending, isWorldless: !hasWorld || turn.isOpening,
    interludes: turn.interludes, remainingMs, untilFreeMs, latencyMs: isCannedNext ? 0 : desk.latencyMs,
  })
  if (!ask) return null
  const isInterlude = ask === 'interlude'
  if (isInterlude) turn.interludes++
  turn.isWrapPending = false
  desk.lastAsk = now
  // after the session's first scene, scenes play in its world; before it, the first sets one up
  const world = hasWorld ? stage.world() : undefined
  const kind: Stamp['kind'] = ask === 'wrap' ? 'wrap' : isInterlude ? 'interlude' : world ? 'scene' : 'first'
  const isTurnOpening = turn.isOpening && kind === 'scene'
  if (kind !== 'interlude') turn.isOpening = false
  const request: Request = {
    kind, world, isInterlude, isTurnOpening, acts: turn.acts, fresh: turn.fresh,
    activity: isInterlude ? undefined : turn.firstFreshAt,
    expectedLeftMs: isInterlude ? remainingMs : untilFreeMs,
  }
  turn.acts = []
  turn.fresh = 0
  turn.firstFreshAt = undefined
  return request
}

/**
 * Whether a scene of this kind is canned under /config's director setting. Hybrid has the model
 * stage the session's world, each turn's opening scene in it, and each wrap-up.
 */
function isCanned(kind: Stamp['kind'], isTurnOpening = false): boolean {
  if (settings.director === 'off') return true
  return settings.director === 'hybrid' && ((kind === 'scene' && !isTurnOpening) || kind === 'interlude')
}

/** Asks the model for the scene; with no usable answer a canned one plays instead, and the model rests a while. */
async function askModel($: EngineInterface, r: Request, now: number) {
  const interlude = r.isInterlude
    ? { n: turn.interludes, quietSecs: Math.round((now - turn.lastActivity) / 1000), isLast: turn.interludes === MAX_INTERLUDES }
    : undefined
  const prompt = buildPrompt({
    goal: turn.goal, log: turn.log, fresh: r.fresh, previous: desk.previous, finished: r.kind === 'wrap', interlude, world: r.world,
    changesLeft: changesLeft(session.changes),
    variety: varietyNotes(desk.recent, Math.random, session.settings, session.world?.setting),
  })
  const mine = desk.epoch
  desk.askingIn = mine
  stage.pondering = true
  let isStaged = false
  try {
    const asked = Date.now()
    const answer = await $.model.complete({ model: settings.model, system: [{ text: SYSTEM, cache: true }], prompt, maxTokens: 1500, effort: 'low', timeoutMs: 45000 })
    const answeredAt = Date.now()
    countUsage($, answer.usage).catch(() => undefined) // bookkeeping: the scene does not wait on the store
    if (answer.isAnswered) desk.latencyMs = blendLatency(desk.latencyMs, answeredAt - asked)
    // a new turn began while the model worked: this scene belongs to the old one
    if (mine !== desk.epoch) return
    if (!answer.isAnswered) return logOnce($, `no scene (${answer.reason})`)
    const parsed = parseScene(answer.text, r.world, { changes: 'director' })
    if ('error' in parsed) return logOnce($, `unusable scene (${parsed.error})`)
    // the director owns the world, within the session's limits
    const { scene, used } = limitChanges(parsed, session.changes)
    session.changes = used
    stageScene(scene, r.isInterlude, { kind: r.kind, activity: r.activity, asked, answered: answeredAt, expectedLeftMs: r.expectedLeftMs })
    isStaged = true
    desk.failures = 0
    desk.hasLoggedError = false
  } catch (err) {
    logOnce($, `director failed (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    if (desk.askingIn === mine) {
      desk.askingIn = null
      stage.pondering = false
    }
    if (!isStaged && mine === desk.epoch) {
      desk.failures++
      desk.retryAfter = Date.now() + Math.min(60_000, 1_000 * 2 ** desk.failures) // 2s, 4s, 8s ... a minute
      stageCanned(r)
    }
  }
}

/** A canned scene for the request; none for a wrap-up of a turn that never got a world. */
function stageCanned(r: Request) {
  const scene = cannedFor(r)
  if (scene) stageScene(scene, r.isInterlude)
}

function cannedFor({ kind, world, acts }: Request): Scene | null {
  if (kind === 'first') return cannedFirst(turn.goal ?? '', session.settings, Math.random)
  if (!world) return null
  if (kind === 'scene') return cannedScene(acts, world, Math.random)
  if (kind === 'interlude') return cannedInterlude(world, turn.interludes, Math.random)
  return cannedWrap(world, turn.lastSaid, false, Math.random)
}

/** Queues a scene: the session's first sets up its world. A model's scene carries its timings. */
function stageScene(scene: Scene, isInterlude: boolean, stamp?: Stamp) {
  if (session.world) scene.setting = session.world.setting
  else {
    session.settings = [...session.settings, scene.setting].slice(-RECENT_SCENES)
    session.world = { setting: scene.setting, props: scene.props.map(p => ({ ...p })), hat: scene.hat ?? 'none' }
    session.isWorldShown = true
  }
  desk.previous = scene
  desk.recent = [...desk.recent, scene].slice(-RECENT_SCENES)
  if (stamp) {
    scene.stamp = stamp
    desk.answered++
  }
  scene.isNews = !isInterlude
  stage.queue(scene)
}

/** A scene that loads the session's world as it stands, with a few beats to arrive on. */
function worldScene(world: SessionWorld, beats: Scene['beats']): Scene {
  return { setting: world.setting, mood: 'neutral', props: world.props.map(p => ({ ...p })), hat: world.hat, beats }
}

/** One line per run of failures: the next scene that lands lets the next failure be told. */
function logOnce($: EngineInterface, why: string) {
  if (!desk.hasLoggedError) $.ui.log(`agent-comic: ${why}`)
  desk.hasLoggedError = true
}

/** Adds a call's tokens to this session's tally and to today's, which is kept across sessions. */
async function countUsage($: EngineInterface, usage: ModelUsage) {
  desk.tally = addUsage(desk.tally, usage)
  const key = `usage:${today()}`
  await $.store.set(key, addUsage(asTally(await $.store.get(key)), usage))
}
