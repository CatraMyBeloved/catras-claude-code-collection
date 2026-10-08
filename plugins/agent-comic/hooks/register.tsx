import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { cannedFirst, cannedInterlude, cannedScene, cannedWrap } from './canned'
import type { Activity } from './canned'
import { cellText } from './canvas'
import { DEMO_MS, demoScene, feelBeat } from './demo'
import { SYSTEM, buildPrompt, describeCall, varietyNotes } from './director'
import { MAX_INTERLUDES, addTiming, blendLatency, emptyTimings, formatTimings, nextAsk } from './pacing'
import type { Timings } from './pacing'
import { HUB_STORE_KEY, HUB_TOOL, HUB_TOOL_SPEC, MAX_HUB_ITEMS, addHubItem, asHubItems, hubItemFrom } from './hub'
import type { HubItem } from './hub'
import { MOODS, clip, parseScene } from './scene'
import type { Mood, Scene, Stamp } from './scene'
import { MAX_PROP_CHANGES, MAX_SCENERY_CHANGES, WORLD_TOOL, WORLD_TOOL_SPEC, describeWorld, withProp, worldChangeFrom } from './world'
import type { SessionWorld } from './world'
import { PACES, Stage } from './stage'
import type { Weather } from './stage'
import { addUsage, asTally, emptyTally, formatStats, today } from './usage'
import type { Tally } from './usage'

/** The /config settings, read when the module (re)loads. */
type Settings = { model: string; pace: keyof typeof PACES; showWhenIdle: boolean; director: Director }
/** Who stages the scenes: the model for all (full), for a turn's opening and wrap-up (hybrid), or none (off). */
type Director = 'full' | 'hybrid' | 'off'
let settings: Settings = { model: 'sonnet', pace: 'calm', showWhenIdle: true, director: 'hybrid' }

const STILL_RUNNING_MS = 4000 // a tool running this long is told to the director before it ends
const LINGER_MS = 25000 // the band stays this long after a turn ends
const FRAME_MS = 50
const MAX_ROWS = 10
const MIN_ROWS = 6
const KEY = 'stage'
const PET_KEY = 'pet'
// a pat, sent as the person's own message: Claude reads it and answers
const PET_LINES = [
  'Here, have a headpat. You are doing amazing!',
  '*pats your head* You are doing great, Claude.',
  'Headpat delivery! Thanks for all the help today.',
  'Here is a little headpat. Keep it up!',
  '*gentle headpat* Proud of you.',
  'Have a headpat, you have earned it!',
  'Headpat break! You are doing wonderfully.',
  '*pat pat* Great work so far.',
]
let lastPetLine = -1
let isPetTurn = false // Claude is answering a pat: the comic stays as it is
let pendingPats: string[] = [] // headpats sent, their turns not begun yet
const HUB_TOOL_NAME = new RegExp(`^mcp__agent-comic__${HUB_TOOL}$`)
const MAX_HUB_ADDS = 2 // keepsakes per session: a milestone, not a habit
const WORLD_TOOL_NAME = new RegExp(`^mcp__agent-comic__${WORLD_TOOL}$`)
const WEATHER_MS = 180_000 // failures this recent cloud the sky
// tools that put a question to the person, who must answer before the turn goes on
const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])
const TEST_RUN = /\b(?:jest|vitest|pytest|mocha|rspec|ctest|tox|phpunit)\b|\b(?:cargo|go|bun|deno|dotnet|mvn|gradle|npm|pnpm|yarn)\s+(?:run\s+)?test\b|\bplugin test\b|\bmake (?:test|check)\b/

const enabled = atom({ plugin: 'agent-comic', key: 'enabled' } as const, true)
const lingering = atom({ plugin: 'agent-comic', key: 'lingering' } as const, false)

const stage = new Stage()
let mount: { requestId: string; columns: number; rows: number } | null = null
let isBlitting = false

let goal: string | null = null
let log: string[] = []
let fresh = 0
let lastActivity = 0
let isTurnRunning = false
let interludes = 0 // asked for since the last new activity
let lastAsk = 0
let epoch = 0 // bumped by each new turn: an answer asked for an older one is dropped
let askingIn: number | null = null // the epoch of the ask under way, if any
let failures = 0 // asks in a row that brought no scene
let retryAfter = 0 // after a failure the director backs off until then
let isWrapPending = false
let previous: Scene | null = null
let recent: Scene[] = [] // the last scenes Sonnet staged, for its variety notes
let turnSettings: Scene['setting'][] = [] // one per turn, oldest first
let turnSetting: Scene['setting'] | null = null // the session world's setting, once its first scene set it up
// the session's world: set up by its first scene, then changed only by Claude's world tool
let sessionWorld: SessionWorld | null = null
let isWorldShown = false // the stage shows the session's world (not home, not the demo's)
let isOpening = false // a new turn's first scene is still to be staged: the model stages it, in the session's world
let propChanges = 0
let sceneryChanges = 0
let hasLoggedError = false
let linger: { cancel: () => void } | null = null
let directorPausedUntil = 0 // while the demo or a /comic-feel plays, Sonnet waits
let sessionTally: Tally = emptyTally()
let latencyMs = 7000 // the director's recent answer time; the first answers correct it
let firstFreshAt: number | undefined // when the oldest activity not yet staged happened
let timings: Timings = emptyTimings()
let acts: Activity[] = [] // what the agent did since the last staged scene, for canned scenes
let lastSaid: string | undefined // the agent's latest remark to the person
let failTimes: number[] = [] // recent failures: they bring clouds, and rain
let hubItems: HubItem[] = []
let hubAdds = 0
let tasksMade = 0 // TaskCreate calls this list
const tasksDone = new Set<string>()
let answered = 0 // scenes the director handed over this session
// the main thread's tool calls under way, to tell the director about long ones before they end
const running = new Map<string, { what: string; since: number; isTold: boolean }>()

function note(line: string) {
  log.push(line)
  log = log.slice(-40)
  if (fresh === 0) firstFreshAt = Date.now()
  fresh++
  lastActivity = Date.now()
  interludes = 0
}

function drawFrame($: EngineInterface) {
  stage.step(Date.now())
  if (!mount || isBlitting) return
  const { requestId, columns, rows } = mount
  isBlitting = true
  $.ui.blit({ requestId, key: KEY, cells: stage.frame(columns, rows) })
    .catch(() => undefined)
    .finally(() => { isBlitting = false })
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

async function direct($: EngineInterface) {
  tellRunning()
  const now = Date.now()
  // between turns, a long idle takes him home through the door
  if (!isTurnRunning && stage.wantsHome) {
    stage.goHome()
    isWorldShown = false
  }
  stage.ambience = { hour: new Date(now).getHours(), weather: weatherNow(now) }
  if (askingIn === epoch || now < directorPausedUntil || isPetTurn) return
  if (!(await read($, enabled)) || askingIn === epoch) return
  const remainingMs = stage.remainingMs
  const untilFreeMs = stage.untilFreeMs
  // a canned scene is ready at once: it is asked for as the stage runs dry, not a model's latency ahead
  const isCannedNext = isCanned(!turnSetting ? 'first' : isWrapPending ? 'wrap' : 'scene', isOpening) || now < retryAfter
  const ask = nextAsk({
    now, pace: settings.pace, fresh, lastAsk, lastActivity, isTurnRunning, isWrapPending,
    isWorldless: !turnSetting || isOpening, interludes, remainingMs, untilFreeMs, latencyMs: isCannedNext ? 0 : latencyMs,
  })
  if (!ask) return
  const finished = ask === 'wrap'
  const isInterlude = ask === 'interlude'
  if (isInterlude) interludes++
  isWrapPending = false
  lastAsk = now
  // after the turn's first scene, scenes play in that world; before it, the first sets one up
  const world = turnSetting ? directorWorld() : undefined
  const kind: Stamp['kind'] = finished ? 'wrap' : isInterlude ? 'interlude' : world ? 'scene' : 'first'
  const isTurnOpening = isOpening && kind === 'scene'
  if (kind !== 'interlude') isOpening = false
  const activity = isInterlude ? undefined : firstFreshAt
  const expectedLeftMs = isInterlude ? remainingMs : untilFreeMs
  const batch = acts
  const unstagedFresh = fresh
  acts = []
  fresh = 0
  firstFreshAt = undefined

  if (isCanned(kind, isTurnOpening) || now < retryAfter) {
    const scene = canned(kind, batch, world)
    if (scene) stageScene(scene, isInterlude)
    return
  }

  const interlude = isInterlude
    ? { n: interludes, quietSecs: Math.round((now - lastActivity) / 1000), isLast: interludes === MAX_INTERLUDES }
    : undefined
  const prompt = buildPrompt({
    goal, log, fresh: unstagedFresh, previous, finished, interlude, world,
    variety: varietyNotes(recent, Math.random, turnSettings, turnSetting ?? undefined),
  })
  const mine = epoch
  askingIn = mine
  stage.pondering = true
  let isStaged = false
  try {
    const asked = Date.now()
    const r = await $.model.complete({ model: settings.model, system: [{ text: SYSTEM, cache: true }], prompt, maxTokens: 1500, effort: 'low', timeoutMs: 45000 })
    const answeredAt = Date.now()
    countUsage($, r.usage).catch(() => undefined) // bookkeeping: the scene does not wait on the store
    if (r.isAnswered) latencyMs = blendLatency(latencyMs, answeredAt - asked)
    // a new turn began while Sonnet worked: this scene belongs to the old one
    if (mine !== epoch) return
    if (!r.isAnswered) return logOnce($, `no scene (${r.reason})`)
    const scene = parseScene(r.text, world, { keepWorld: world !== undefined })
    if ('error' in scene) return logOnce($, `unusable scene (${scene.error})`)
    stageScene(scene, isInterlude, { kind, activity, asked, answered: answeredAt, expectedLeftMs })
    isStaged = true
    failures = 0
    hasLoggedError = false
  } catch (err) {
    logOnce($, `director failed (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    if (askingIn === mine) {
      askingIn = null
      stage.pondering = false
    }
    if (!isStaged && mine === epoch) {
      // no scene from the model: a canned one plays instead, and the model rests a while
      failures++
      retryAfter = Date.now() + Math.min(60_000, 1_000 * 2 ** failures) // 2s, 4s, 8s ... a minute
      const scene = canned(kind, batch, world)
      if (scene) stageScene(scene, isInterlude)
    }
  }
}

/**
 * Whether a scene of this kind is canned under the /config director setting. Hybrid has the model
 * stage the session's world, each turn's opening scene in it, and each wrap-up.
 */
function isCanned(kind: Stamp['kind'], isTurnOpening = false): boolean {
  if (settings.director === 'off') return true
  return settings.director === 'hybrid' && ((kind === 'scene' && !isTurnOpening) || kind === 'interlude')
}

/** A canned scene of `kind`; none for a wrap-up of a turn that never got a world. */
function canned(kind: Stamp['kind'], batch: readonly Activity[], world: ReturnType<Stage['world']> | undefined): Scene | null {
  if (kind === 'first') return cannedFirst(goal ?? '', turnSettings, Math.random)
  if (!world) return null
  if (kind === 'scene') return cannedScene(batch, world, Math.random)
  if (kind === 'interlude') return cannedInterlude(world, interludes, Math.random)
  return cannedWrap(world, lastSaid, false, Math.random)
}

/** Queues a scene for the turn: the first one fixes the turn's setting. Model scenes carry their timings. */
function stageScene(scene: Scene, isInterlude: boolean, stamp?: Stamp) {
  // the world changes between turns, not within one: later scenes keep the first scene's setting
  if (turnSetting) scene.setting = turnSetting
  else {
    // the session's first scene: its world stays for the session
    turnSetting = scene.setting
    turnSettings = [...turnSettings, scene.setting].slice(-6)
    sessionWorld = { setting: scene.setting, props: scene.props.map(p => ({ ...p })), hat: scene.hat ?? 'none' }
    isWorldShown = true
  }
  previous = scene
  recent = [...recent, scene].slice(-6)
  if (stamp) {
    scene.stamp = stamp
    answered++
  }
  scene.isNews = !isInterlude
  stage.queue(scene)
}

/**
 * The world as the director should stage it: where the stage has the props now, with what Claude
 * made of them (a change he asked for counts at once, before its animation has played).
 */
function directorWorld(): ReturnType<Stage['world']> {
  const seen = stage.world()
  if (!sessionWorld || seen.setting !== sessionWorld.setting) return seen
  const now = new Map(sessionWorld.props.map(p => [p.id, p]))
  return { ...seen, props: seen.props.map(p => (now.has(p.id) ? { ...p, kind: now.get(p.id)!.kind, label: now.get(p.id)!.label } : p)) }
}

/** A scene that loads the session's world as it stands, with a few beats to arrive on. */
function worldScene(world: SessionWorld, beats: Scene['beats']): Scene {
  return { setting: world.setting, mood: 'neutral', props: world.props.map(p => ({ ...p })), hat: world.hat, beats }
}

/** Clear, cloudy after a failure, rain after several: the last few minutes' work, in the sky. */
function weatherNow(now: number): Weather {
  failTimes = failTimes.filter(t => now - t < WEATHER_MS)
  return failTimes.length >= 3 ? 'rain' : failTimes.length ? 'cloudy' : 'clear'
}

const baseName = (path: string) => clip(cellText(path.split(/[\\/]/).pop() ?? path), 20)

/**
 * One main-thread tool call as the comic sees it: an activity for canned scenes, and its
 * side effects: git moments, the task trail, failures for the weather.
 */
function observe(e: Record<string, unknown>, ran: { isError?: boolean; deny?: string }) {
  const tool = String(e.tool)
  const str = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const failed = ran.isError === true || ran.deny !== undefined
  const fail = (label?: string) => {
    failTimes.push(Date.now())
    acts.push({ kind: 'fail', label })
  }
  switch (tool) {
    case 'Read': case 'NotebookRead':
      return failed ? fail(baseName(str('file_path'))) : acts.push({ kind: 'read', label: baseName(str('file_path')) })
    case 'Edit': case 'Write': case 'NotebookEdit':
      return failed ? fail(baseName(str('file_path'))) : acts.push({ kind: 'edit', label: baseName(str('file_path')) })
    case 'Grep': case 'Glob':
      return acts.push({ kind: 'search', label: clip(cellText(str('pattern')), 20) })
    case 'WebFetch': case 'WebSearch':
      return failed ? fail() : acts.push({ kind: 'web' })
    case 'Agent':
      return acts.push({ kind: 'helper' })
    case 'TodoWrite': {
      const todos = Array.isArray(e.todos) ? (e.todos as { status?: unknown }[]) : []
      const done = todos.filter(t => t?.status === 'completed').length
      stage.progress = todos.length ? { done, total: todos.length } : null
      return
    }
    case 'TaskCreate':
      if (!failed) tasksMade++
      return showTasks()
    case 'TaskUpdate': {
      const id = str('taskId') || str('id')
      if (!failed && id && e.status === 'completed') tasksDone.add(id)
      return showTasks()
    }
    case 'Bash': case 'PowerShell': {
      const command = str('command')
      if (/\bgit\s+commit\b/.test(command) && !failed) {
        stage.gitMoment('commit')
        return acts.push({ kind: 'commit' })
      }
      if (/\bgit\s+push\b/.test(command) && !failed) {
        stage.gitMoment('push')
        return acts.push({ kind: 'push' })
      }
      if (TEST_RUN.test(command)) {
        if (failed) failTimes.push(Date.now())
        else failTimes = [] // green again: the sky clears
        return acts.push({ kind: 'test', ok: !failed })
      }
      return failed ? fail() : acts.push({ kind: 'run' })
    }
  }
  if (failed) fail()
}

/**
 * A pat: hearts at once, and the headpat sent as the person's message. Sent from a timer, once the
 * hook that asked has returned: a prompt made inside a command would wait on the turn the command holds.
 */
function pat($: EngineInterface) {
  stage.pet()
  const text = petLine()
  pendingPats.push(text)
  $.clock.after(0, () => $.prompt.submit({ text, asUser: true }).catch(() => undefined))
}

/** A pat's message, never the same one twice running. */
function petLine(): string {
  let i = Math.floor(Math.random() * PET_LINES.length)
  if (i === lastPetLine) i = (i + 1) % PET_LINES.length
  lastPetLine = i
  return PET_LINES[i]!
}

function showTasks() {
  if (tasksMade > 0) stage.progress = { done: Math.min(tasksDone.size, tasksMade), total: tasksMade }
}

/** Asks now rather than at the next tick: a new turn, or its end, should not wait a second. */
function askSoon($: EngineInterface) {
  $.clock.after(0, () => direct($).catch(() => undefined))
}

/** One line per run of failures: the next scene that lands lets the next failure be told. */
function logOnce($: EngineInterface, why: string) {
  if (!hasLoggedError) $.ui.log(`agent-comic: ${why}`)
  hasLoggedError = true
}

/** Adds a call's tokens to this session's tally and to today's, which is kept across sessions. */
async function countUsage($: EngineInterface, usage: Parameters<typeof addUsage>[1]) {
  sessionTally = addUsage(sessionTally, usage)
  const key = `usage:${today()}`
  await $.store.set(key, addUsage(asTally(await $.store.get(key)), usage))
}

function endLinger($: EngineInterface) {
  void update($, lingering, () => false)
}

/** Keeps the band up for `ms` even with no turn running, and holds the director off. */
async function showFor($: EngineInterface, ms: number) {
  directorPausedUntil = Date.now() + ms
  await update($, lingering, () => true)
  linger?.cancel()
  linger = $.clock.after(ms, () => endLinger($))
}

/** Which mark each tool puts over Claude's head as it starts. */
const CUES: Record<string, Parameters<Stage['cue']>[0]> = {
  Read: 'read', NotebookRead: 'read',
  Grep: 'search', Glob: 'search',
  Edit: 'edit', Write: 'edit', NotebookEdit: 'edit',
  Bash: 'run', PowerShell: 'run',
  WebFetch: 'web', WebSearch: 'web',
}

const FEELINGS = MOODS.filter((m): m is Exclude<Mood, 'neutral'> => m !== 'neutral')

export const register: Register = (on, options) => {
  settings = {
    model: options.model === 'haiku' ? 'haiku' : 'sonnet',
    pace: options.pace === 'normal' || options.pace === 'lively' ? options.pace : 'calm',
    showWhenIdle: options.showWhenIdle !== false,
    director: options.director === 'full' || options.director === 'off' ? options.director : 'hybrid',
  }
  stage.pace = PACES[settings.pace]
  latencyMs = settings.model === 'haiku' ? 4000 : 7000
  stage.onPlay = scene => {
    if (scene.stamp) timings = addTiming(timings, scene.stamp, Date.now())
  }

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('enabled')
    if (typeof stored === 'boolean') await update($, enabled, () => stored)

    await $.command.register({ name: 'comic', description: 'Turn the agent comic above the prompt on or off' })
    await $.command.register({ name: 'comic-demo', description: 'Play the comic tour: every mood, then every action, captioned' })
    await $.command.register({ name: 'comic-stats', description: 'Show the tokens the comic director has spent: this session and today' })
    await $.command.register({ name: 'comic-feel', description: `Make Claude act out a mood: ${FEELINGS.join(', ')}` })

    await $.command.register({ name: 'comic-pet', description: 'Give the little Claude above the prompt a pat' })
    await $.command.register({ name: 'comic-hub', description: 'List the keepsakes in the comic hub, or remove one: /comic-hub remove <n>' })
    // the hub: the session opens there, among the keepsakes of earlier sessions
    hubItems = asHubItems(await $.store.get(HUB_STORE_KEY))
    stage.setHome(hubItems)
    stage.startHome()
    await $.tool.register(HUB_TOOL_SPEC)
    await $.tool.register(WORLD_TOOL_SPEC)

    $.clock.every(FRAME_MS, () => drawFrame($))
    $.clock.every(1000, () => direct($).catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: 'comic' }, async $ => {
    const isOn = !(await read($, enabled))
    await update($, enabled, () => isOn)
    await $.store.set('enabled', isOn)
    return { text: isOn ? 'Comic on: it plays above the prompt while Claude works.' : 'Comic off.' }
  })

  on('command.run', { command: 'comic-demo' }, async $ => {
    stage.queue(demoScene(), true)
    isWorldShown = false // the tour plays in a world of its own; the next turn goes back to the session's
    await showFor($, DEMO_MS)
    return { text: `Comic tour playing above the prompt (about ${Math.round(DEMO_MS / 1000)}s): ${FEELINGS.length} moods, then the actions.` }
  })

  on('command.run', { command: 'comic-stats' }, async $ => {
    const key = today()
    const day = asTally(await $.store.get(`usage:${key}`))
    return { text: `${formatStats(settings.model, sessionTally, day, key)}

${formatTimings(timings, latencyMs, answered)}` }
  })

  on('command.run', { command: 'comic-hub' }, async ($, e) => {
    const remove = /^remove\s+(\d+)$/.exec(e.args.trim())
    if (remove) {
      const n = Number(remove[1])
      if (n < 1 || n > hubItems.length) return { text: `No keepsake ${n}: the hub has ${hubItems.length}.` }
      const [gone] = hubItems.splice(n - 1, 1)
      hubItems = [...hubItems]
      await $.store.set(HUB_STORE_KEY, hubItems)
      stage.setHome(hubItems)
      return { text: `Removed the ${gone!.kind} "${gone!.label}".` }
    }
    if (!hubItems.length) return { text: 'The hub has no keepsakes yet. Claude adds one after a real milestone.' }
    const lines = hubItems.map((h, i) => `${i + 1}. ${h.kind}: ${h.label} (${new Date(h.at).toISOString().slice(0, 10)})`)
    return { text: `Keepsakes in the hub, oldest first:\n${lines.join('\n')}\n\nRemove one with /comic-hub remove <n>.` }
  })

  // the comic's own tool: Claude keeps a milestone in the hub
  on('tool.call', { tool: HUB_TOOL_NAME }, async ($, e) => {
    if (hubAdds >= MAX_HUB_ADDS) return { result: 'Not added: the hub already got its keepsake this session. Keep the next one for another milestone.' }
    const item = hubItemFrom(e, Date.now())
    if ('error' in item) return { result: `Not added: ${item.error}.` }
    hubAdds++
    const { items, retired } = addHubItem(hubItems, item)
    hubItems = items
    await $.store.set(HUB_STORE_KEY, hubItems)
    stage.setHome(hubItems.slice(0, -1))
    stage.addHomeItem(item)
    const room = retired ? ` The hub holds ${MAX_HUB_ITEMS}, so the oldest, the ${retired.kind} "${retired.label}", was retired.` : ''
    return { result: `Added a ${item.kind} "${item.label}" to the hub; it is there whenever Claude Code starts.${room}` }
  })

  // the comic's world tool: only Claude changes the session's world, a prop or the whole scenery
  on('tool.call', { tool: WORLD_TOOL_NAME }, async ($, e) => {
    const change = worldChangeFrom(e, sessionWorld)
    if ('error' in change) return { result: `Not changed: ${change.error}.` }
    if (change.kind === 'look') return { result: sessionWorld ? describeWorld(sessionWorld) : 'No world yet: the first scene of the session sets it up.' }
    if (change.kind === 'prop') {
      if (propChanges >= MAX_PROP_CHANGES) return { result: `Not changed: the world already had its ${MAX_PROP_CHANGES} prop changes this session.` }
      propChanges++
      sessionWorld = withProp(sessionWorld!, change.id, change.into, change.label)
      if (isWorldShown) stage.changeProp(change.id, change.into, change.label)
      return { result: `Claude lifts ${change.id} and it becomes a ${change.into}${change.label ? ` "${change.label}"` : ''}. ${describeWorld(sessionWorld)}` }
    }
    if (sceneryChanges >= MAX_SCENERY_CHANGES) return { result: `Not changed: the scenery already changed ${MAX_SCENERY_CHANGES} times this session.` }
    sceneryChanges++
    sessionWorld = change.world
    turnSetting = change.world.setting
    turnSettings = [...turnSettings, change.world.setting].slice(-6)
    // what the director was staging belongs to the old place
    epoch++
    const first = sessionWorld.props[0]
    stage.changeScenery(worldScene(sessionWorld, [{ do: 'emote', mood: 'happy', secs: 1.5 }, ...(first ? [{ do: 'look' as const, at: first.id }] : [])]))
    isWorldShown = true
    return { result: `Claude summons a door and walks through into the ${change.world.setting}. ${describeWorld(sessionWorld)}` }
  })

  // a /clear is a new conversation: its first turn sets up a new world
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      sessionWorld = null
      turnSetting = null
      propChanges = 0
      sceneryChanges = 0
    }
    return next(e)
  })

  // a pat: the ♥ at the band's edge, or /comic-pet
  on('ui.press', { element: PET_KEY }, async $ => {
    pat($)
    return { element: PET_KEY }
  })

  on('command.run', { command: 'comic-pet' }, async $ => {
    pat($)
    return { text: 'A headpat, on its way.' }
  })

  on('command.run', { command: 'comic-feel' }, async ($, e) => {
    const mood = FEELINGS.find(m => m === e.args.trim().toLowerCase())
    if (!mood) return { text: `Usage: /comic-feel <mood>, one of: ${FEELINGS.join(', ')}` }
    stage.interject([feelBeat(mood)])
    await showFor($, 9000)
    return { text: `Claude is ${mood}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    // our own headpat (should a hook of ours see it): its turn is told apart as it starts, below
    const origin = e.origin as { kind?: string; name?: string } | undefined
    if (origin?.kind === 'plugin' && origin.name === 'agent-comic') return next(e)
    linger?.cancel()
    // typed over the running turn, or delivered into it: the same story goes on
    if (e.turnId !== undefined) {
      note(`the person added: ${e.text.slice(0, 300)}`)
      return next(e)
    }
    epoch++
    retryAfter = 0
    goal = e.text.slice(0, 300)
    log = []
    acts = []
    lastSaid = undefined
    stage.attention = null
    // a finished task list is done with; one still under way carries on into this turn
    if (stage.progress && stage.progress.done >= stage.progress.total) {
      stage.progress = null
      tasksMade = 0
      tasksDone.clear()
    }
    fresh = 0
    lastAsk = 0
    isWrapPending = false
    isTurnRunning = true
    // the session's world carries on: only its first turn sets one up
    turnSetting = sessionWorld?.setting ?? null
    isOpening = sessionWorld !== null
    note(`the person asked: ${goal}`)
    // something to see at once: at home he heads for the door, elsewhere (idle, or asleep) he stops to think
    const isLeaving = stage.leaveHome()
    // back from home (or the demo): the session's world loads as he steps in, as he left it
    if (sessionWorld && !isWorldShown) {
      stage.queue(worldScene(sessionWorld, [{ do: 'ponder', secs: 1.5 }]))
      isWorldShown = true
    } else if (!isLeaving && stage.idleMs > 0) stage.interject([{ do: 'ponder', secs: 2 }])
    askSoon($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // a subagent's own tool calls: its small Claude acts them out
    if (e.agentId) stage.helperActivity(e.agentId, e.tool)
    // a subagent started from the main thread: a small Claude walks in, and reports back when it is done
    const input = e as unknown as { description?: unknown; run_in_background?: unknown }
    const isHelper = e.tool === 'Agent' && !e.agentId
    if (isHelper) {
      const label = typeof input.description === 'string' ? input.description : 'helper'
      stage.helperStart(e.tool_use_id, label, input.run_in_background === true)
    }
    // the main thread's own calls: a mark over Claude's head at once, while Sonnet catches up
    const isMain = !e.agentId && !isHelper
    if (isMain) {
      const cue = CUES[e.tool]
      if (cue) stage.cue(cue)
      running.set(e.tool_use_id, { what: describeCall(e as unknown as Record<string, unknown>, {}), since: Date.now(), isTold: false })
    }
    // a question for the person: he turns to them until it is answered
    const isAsking = isMain && ASKS_PERSON.has(e.tool)
    if (isAsking) stage.attention = 'question'
    const startedAt = Date.now()
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } finally {
      running.delete(e.tool_use_id)
      // answered (a question, or a permission prompt on the way): back to the story
      if (isMain) stage.attention = null
    }
    if (isMain && (ran.isError || ran.deny)) stage.cue('fail')
    if (isMain) observe(e as unknown as Record<string, unknown>, ran)
    if (isHelper) {
      // back within a few seconds: it was only launched and works on in the background
      if (input.run_in_background === true || Date.now() - startedAt < 5000) stage.helperBackground(e.tool_use_id)
      else stage.helperDone(e.tool_use_id)
    }
    note(describeCall(e as unknown as Record<string, unknown>, ran))
    return ran
  })

  // a permission dialog about to be put to the person (no hook answered it, and in auto mode
  // the classifier did not settle it): he turns to them while it is up
  on('classic.PermissionRequest', async ($, e, next) => {
    const answer = await next(e)
    const isAnswered = (answer as { decision?: unknown } | undefined)?.decision !== undefined
    if (!isAnswered && !(e as { agent_id?: string }).agent_id) stage.attention = 'permission'
    return answer
  })

  // the tool is running (its progress row is up): the dialog was answered
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (stage.attention === 'permission') stage.attention = null
    return next(e)
  })

  // a subagent finished, foreground or background: its small Claude walks over and reports
  on('classic.SubagentStop', async ($, e, next) => {
    stage.helperDoneByAgent(e.agent_id)
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door === 'response' && !e.agentId && !isPetTurn) {
      const text = e.message.content
        .map(b => (b.type === 'text' ? b.text : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) {
        note(`the agent said: ${text.slice(0, 220)}`)
        lastSaid = clip(cellText(text), 120)
        acts.push({ kind: 'said', text: clip(cellText(text), 60) })
      }
    }
    return stored
  })

  // the turn answering a pat: he stays where he is, glowing, while Claude answers; no world, no scenes
  on('turn.start', async ($, e, next) => {
    const i = pendingPats.indexOf(e.text)
    if (i >= 0) {
      pendingPats.splice(i, 1)
      isPetTurn = true
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // a subagent's turn ends inside the main one: its small Claude reports through SubagentStop
    if (e.agentId) return done
    if (isPetTurn) {
      isPetTurn = false
      return done
    }
    isTurnRunning = false
    stage.attention = null
    if (e.reason === 'aborted') {
      // stopped by the person: no celebration, and what was asked for the stopped work is dropped;
      // a shrug in the turn's world says so, no model needed
      epoch++
      fresh = 0
      firstFreshAt = undefined
      isWrapPending = false
      acts = []
      if (turnSetting) stage.queue(cannedWrap(stage.world(), undefined, true, Math.random))
    } else {
      isWrapPending = true
      askSoon($)
    }
    await update($, lingering, () => true)
    linger?.cancel()
    linger = $.clock.after(LINGER_MS, () => endLinger($))
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isOn = await read($, enabled)
    const rows = Math.min(MAX_ROWS, e.props.maxRows - 1)
    // always up while on: Claude idles between turns (no Sonnet calls then) and dozes off after a while
    const isLingering = settings.showWhenIdle || (await read($, lingering))
    const isShown = isOn && !e.props.hasSurvey && rows >= MIN_ROWS && (e.props.isWorking || isLingering)

    if (!isShown || e.surface !== 'terminal') {
      mount = null
      return next(e)
    }

    // the stage, and a ♥ beside it to give him a pat (a Raster takes no clicks of its own). A click
    // reaches it in the fullscreen terminal; anywhere, ctrl+x tab focuses the band and p presses it
    const columns = Math.max(20, Math.min(512, e.props.bodyColumns - 5))
    mount = { requestId: e.requestId, columns, rows }
    const { Box, Button, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Raster key={KEY} columns={columns} rows={rows} cells={stage.frame(columns, rows)} />
        <Box flexDirection="column" paddingLeft={1}>
          <Button key={PET_KEY} plain hotkey="p" onPress={() => undefined}>♥</Button>
        </Box>
      </Box>
    )
  })
}
