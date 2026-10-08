import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { DEMO_MS, demoScene, feelBeat } from './demo'
import { SYSTEM, buildPrompt, describeCall, varietyNotes } from './director'
import { MAX_INTERLUDES, addTiming, blendLatency, emptyTimings, formatTimings, nextAsk } from './pacing'
import type { Timings } from './pacing'
import { MOODS, parseScene } from './scene'
import type { Mood, Scene } from './scene'
import { PACES, Stage } from './stage'
import { addUsage, asTally, emptyTally, formatStats, today } from './usage'
import type { Tally } from './usage'

/** The /config settings, read when the module (re)loads. */
type Settings = { model: string; pace: keyof typeof PACES; showWhenIdle: boolean }
let settings: Settings = { model: 'sonnet', pace: 'calm', showWhenIdle: true }

const STILL_RUNNING_MS = 4000 // a tool running this long is told to the director before it ends
const LINGER_MS = 25000 // the band stays this long after a turn ends
const FRAME_MS = 50
const MAX_ROWS = 10
const MIN_ROWS = 6
const KEY = 'stage'

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
let isAsking = false
let isWrapPending = false
let previous: Scene | null = null
let recent: Scene[] = [] // the last scenes Sonnet staged, for its variety notes
let turnSettings: string[] = [] // one per turn, oldest first
let turnSetting: Scene['setting'] | null = null // picked by the turn's first scene, then fixed
let hasLoggedError = false
let linger: { cancel: () => void } | null = null
let directorPausedUntil = 0 // while the demo or a /comic-feel plays, Sonnet waits
let sessionTally: Tally = emptyTally()
let latencyMs = 7000 // the director's recent answer time; the first answers correct it
let firstFreshAt: number | undefined // when the oldest activity not yet staged happened
let timings: Timings = emptyTimings()
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
  if (isAsking || Date.now() < directorPausedUntil || !(await read($, enabled))) return
  const remainingMs = stage.remainingMs
  const untilFreeMs = stage.untilFreeMs
  const ask = nextAsk({
    now: Date.now(), pace: settings.pace, fresh, lastAsk, lastActivity, isTurnRunning, isWrapPending,
    isWorldless: !turnSetting, interludes, remainingMs, untilFreeMs, latencyMs,
  })
  if (!ask) return
  const finished = ask === 'wrap'
  const isInterlude = ask === 'interlude'
  if (isInterlude) interludes++
  isWrapPending = false
  isAsking = true
  stage.pondering = true
  lastAsk = Date.now()
  const interlude = isInterlude
    ? { n: interludes, quietSecs: Math.round((Date.now() - lastActivity) / 1000), isLast: interludes === MAX_INTERLUDES }
    : undefined
  // after the turn's first scene, Sonnet works in that world; before it, it sets one up
  const world = turnSetting ? stage.world() : undefined
  const prompt = buildPrompt({
    goal, log, fresh, previous, finished, interlude, world,
    variety: varietyNotes(recent, Math.random, turnSettings, turnSetting ?? undefined),
  })
  const activity = isInterlude ? undefined : firstFreshAt
  const kind = finished ? 'wrap' : isInterlude ? 'interlude' : world ? 'scene' : 'first'
  const expectedLeftMs = isInterlude ? remainingMs : untilFreeMs
  fresh = 0
  firstFreshAt = undefined
  try {
    const asked = Date.now()
    const r = await $.model.complete({ model: settings.model, system: SYSTEM, prompt, maxTokens: 1500, effort: 'low', timeoutMs: 45000 })
    const answeredAt = Date.now()
    await countUsage($, r.usage)
    if (r.isAnswered) latencyMs = blendLatency(latencyMs, answeredAt - asked)
    if (!r.isAnswered) {
      if (!hasLoggedError) $.ui.log(`agent-comic: no scene (${r.reason})`)
      hasLoggedError = true
      return
    }
    const scene = parseScene(r.text, world)
    if ('error' in scene) {
      if (!hasLoggedError) $.ui.log(`agent-comic: unusable scene (${scene.error})`)
      hasLoggedError = true
      return
    }
    // the world changes between turns, not within one: later scenes keep the first scene's setting
    if (turnSetting) scene.setting = turnSetting
    else {
      turnSetting = scene.setting
      turnSettings = [...turnSettings, scene.setting].slice(-6)
    }
    previous = scene
    recent = [...recent, scene].slice(-6)
    scene.stamp = { kind, activity, asked, answered: answeredAt, expectedLeftMs }
    scene.isNews = !isInterlude
    answered++
    stage.queue(scene)
  } finally {
    isAsking = false
    stage.pondering = false
  }
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

    $.clock.every(FRAME_MS, () => drawFrame($))
    $.clock.every(1000, () => void direct($))

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
    await showFor($, DEMO_MS)
    return { text: `Comic tour playing above the prompt (about ${Math.round(DEMO_MS / 1000)}s): ${FEELINGS.length} moods, then the actions.` }
  })

  on('command.run', { command: 'comic-stats' }, async $ => {
    const key = today()
    const day = asTally(await $.store.get(`usage:${key}`))
    return { text: `${formatStats(settings.model, sessionTally, day, key)}

${formatTimings(timings, latencyMs, answered)}` }
  })

  on('command.run', { command: 'comic-feel' }, async ($, e) => {
    const mood = FEELINGS.find(m => m === e.args.trim().toLowerCase())
    if (!mood) return { text: `Usage: /comic-feel <mood>, one of: ${FEELINGS.join(', ')}` }
    stage.interject([feelBeat(mood)])
    await showFor($, 9000)
    return { text: `Claude is ${mood}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    goal = e.text.slice(0, 300)
    log = []
    fresh = 0
    lastAsk = 0
    isWrapPending = false
    isTurnRunning = true
    turnSetting = null
    linger?.cancel()
    note(`the person asked: ${goal}`)
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
    const startedAt = Date.now()
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } finally {
      running.delete(e.tool_use_id)
    }
    if (isMain && (ran.isError || ran.deny)) stage.cue('fail')
    if (isHelper) {
      // back within a few seconds: it was only launched and works on in the background
      if (input.run_in_background === true || Date.now() - startedAt < 5000) stage.helperBackground(e.tool_use_id)
      else stage.helperDone(e.tool_use_id)
    }
    note(describeCall(e as unknown as Record<string, unknown>, ran))
    return ran
  })

  // a subagent finished, foreground or background: its small Claude walks over and reports
  on('classic.SubagentStop', async ($, e, next) => {
    stage.helperDoneByAgent(e.agent_id)
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door === 'response' && !e.agentId) {
      const text = e.message.content
        .map(b => (b.type === 'text' ? b.text : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) note(`the agent said: ${text.slice(0, 220)}`)
    }
    return stored
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    isWrapPending = true
    isTurnRunning = false
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

    const columns = Math.max(20, Math.min(512, e.props.bodyColumns))
    mount = { requestId: e.requestId, columns, rows }
    const { Raster } = $.ui.resolve(e)
    return <Raster key={KEY} columns={columns} rows={rows} cells={stage.frame(columns, rows)} />
  })
}
