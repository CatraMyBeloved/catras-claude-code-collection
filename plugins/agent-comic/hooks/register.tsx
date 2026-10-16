// agent-comic: a pixel comic in the band above the prompt, where a little Claude acts out what the agent
// is doing. This module wires it into Claude Code: the hooks, the commands and the band.
//
//   stage.ts plays and draws the comic, with the hub (home.ts) and the subagents' helpers (helpers.ts);
//   director.ts stages it from what the agent does (activity.ts) with the model or canned scenes;
//   state.ts and places.ts keep the ring of places other plugins add through $.comic (EXTENDING.md).

import type { EngineInterface, On, Register } from 'claude-code'

import type { Comic } from '../types'
import { CUES, clearFinishedTasks, observe } from './activity'
import { RASTER_KEY, desktopChunk, getSvgMode, hideBand, setSvgMode, startBand, terminalCells } from './band'
import { DEMO_MS, demoScene, feelBeat } from './demo'
import {
  act, addToTurn, beginTurn, endTurn, forgetWorld, heard, isTurnRunning, leaveWorld, note, pauseFor, startDirector, stats, tick, toolEnded, toolStarted,
} from './director'
import { HUB_STORE_KEY, HUB_TOOL, HUB_TOOL_SPEC, MAX_HUB_ITEMS, addHubItem, asHubItems, hubItemFrom } from './hub'
import type { HubItem } from './hub'
import { givePat, pats } from './pets'
import { COMIC_VERSION, HUB, asPlace, kit, routeOf } from './places'
import { describeCall } from './prompt'
import { applySettings, settings, stage } from './runtime'
import { MOODS } from './scene'
import type { Mood } from './scene'
import {
  addPlace, checkPlace, goTo, isEnabled, isLingering, placeAlive, removePlace, routeNow, setEnabled, setLingering, stepTo, stops, syncState, whereNow,
} from './state'

const LINGER_MS = 25_000 // the band stays this long after a turn ends
const FEEL_MS = 9000 // the band stays up this long for a /comic-feel
const MAX_ROWS = 10
const MIN_ROWS = 6
const PET_KEY = 'pet'
const SIGN_LEFT = 'sign-left'
const SIGN_RIGHT = 'sign-right'
const HUB_TOOL_NAME = new RegExp(`^mcp__agent-comic__${HUB_TOOL}$`)
const MAX_HUB_ADDS = 2 // keepsakes per session: a milestone, not a habit
/** Tools that put a question to the person, who must answer before the turn goes on. */
const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])
const FEELINGS = MOODS.filter((m): m is Exclude<Mood, 'neutral'> => m !== 'neutral')

/** The keepsakes in the hub (kept across sessions), and how many Claude added this session. */
const hub = { items: [] as HubItem[], added: 0 }
let linger: { cancel: () => void } | null = null

/** A turn runs, or Claude answers a pat. */
const isWorking = () => isTurnRunning() || pats.isAnswering
const sync = ($: EngineInterface) => syncState($, isWorking)

export const register: Register = (on, options) => {
  applySettings(options)
  startDirector()
  registerPlaces(on)
  registerSession(on)
  registerCommands(on)
  registerHub(on)
  registerTurns(on)
  registerBand(on)
}

/** Keeps the band up for `ms` with no turn running, then lets it go. */
async function lingerFor($: EngineInterface, ms: number) {
  await setLingering($, true)
  await sync($)
  linger?.cancel()
  linger = $.clock.after(ms, () => {
    void setLingering($, false).then(() => sync($)).catch(() => undefined)
  })
}

/** Plays something of the person's own (the demo, a /comic-feel): the band stays up for it, and the director waits. */
async function showFor($: EngineInterface, ms: number) {
  pauseFor(ms)
  await lingerFor($, ms)
}

/** $.comic: other plugins add places to the comic's world (EXTENDING.md), and the hub's signs lead there. */
function registerPlaces(on: On) {
  // its plain answers; the hooks below do the work, since only a hook has $
  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    const comic: Comic = {
      version: async () => COMIC_VERSION,
      addPlace: async () => undefined,
      removePlace: async () => undefined,
      places: async () => [HUB],
      route: async () => ({ left: null, right: null }),
      go: async () => undefined,
      step: async () => undefined,
      alive: async () => undefined,
      kit: async () => kit(),
    }
    return { ...built, comic }
  })

  on('comic.addPlace', async ($, e, next) => {
    const place = asPlace(e)
    if (place) await addPlace($, place)
    return next(e)
  })

  on('comic.removePlace', async ($, e, next) => {
    if (typeof e.id === 'string') await removePlace($, e.id)
    return next(e)
  })

  on('comic.places', async $ => ({ value: await stops($) }))

  on('comic.route', async $ => ({ value: await routeNow($) }))

  on('comic.go', async ($, e, next) => {
    if (e.id === null || typeof e.id === 'string') await goTo($, e.id, null)
    return next(e)
  })

  on('comic.step', async ($, e, next) => {
    if (e.dir === -1 || e.dir === 1) await stepTo($, e.dir)
    return next(e)
  })

  on('comic.alive', async ($, e, next) => {
    const place = asPlace(e)
    if (place) await placeAlive($, place)
    return next(e)
  })

  // a sign at the hub's edge: Claude goes to the place beside it
  on('ui.press', { element: SIGN_LEFT }, async $ => {
    await stepTo($, -1)
    return { element: SIGN_LEFT }
  })

  on('ui.press', { element: SIGN_RIGHT }, async $ => {
    await stepTo($, 1)
    return { element: SIGN_RIGHT }
  })
}

/** The session opens at home among the keepsakes of earlier sessions, and the clocks start. */
function registerSession(on: On) {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('enabled')
    if (typeof stored === 'boolean') await setEnabled($, stored)
    await sync($)

    await $.command.register({ name: 'comic', description: 'Turn the agent comic above the prompt on or off' })
    await $.command.register({ name: 'comic-demo', description: 'Play the comic tour: every mood, then every action, captioned' })
    await $.command.register({ name: 'comic-stats', description: 'Show the tokens the comic director has spent: this session and today' })
    await $.command.register({ name: 'comic-feel', description: `Make Claude act out a mood: ${FEELINGS.join(', ')}` })
    await $.command.register({ name: 'comic-pet', description: 'Give the little Claude above the prompt a pat' })
    await $.command.register({ name: 'comic-hub', description: 'List the keepsakes in the comic hub, or remove one: /comic-hub remove <n>' })

    hub.items = asHubItems(await $.store.get(HUB_STORE_KEY))
    stage.home.setItems(hub.items)
    stage.startHome()
    await $.tool.register(HUB_TOOL_SPEC)

    await startBand($)
    $.clock.every(1000, () => tick($).catch(() => undefined))
    $.clock.every(1000, () => checkPlace($).catch(() => undefined))
    return next(e)
  })

  // a /clear is a new conversation: its first turn sets up a new world
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') forgetWorld()
    return next(e)
  })
}

function registerCommands(on: On) {
  on('command.run', { command: 'comic' }, async ($, e) => {
    const [verb, mode] = e.args.trim().split(/\s+/)
    if (verb === 'svg') {
      if (mode !== 'image' && mode !== 'frame') return { text: `Desktop drawing: ${getSvgMode()}. Use /comic svg image or /comic svg frame.` }
      await setSvgMode($, mode)
      $.ui.invalidate('ui.render')
      return { text: `Desktop drawing set to ${mode}.` }
    }
    const isOn = !(await isEnabled($))
    await setEnabled($, isOn)
    await $.store.set('enabled', isOn)
    await sync($)
    return { text: isOn ? 'Comic on: it plays above the prompt while Claude works.' : 'Comic off.' }
  })

  on('command.run', { command: 'comic-demo' }, async $ => {
    stage.queue(demoScene(), true)
    leaveWorld() // the tour plays in a world of its own; the next turn goes back to the session's
    await showFor($, DEMO_MS)
    return { text: `Comic tour playing above the prompt (about ${Math.round(DEMO_MS / 1000)}s): ${FEELINGS.length} moods, then the actions.` }
  })

  on('command.run', { command: 'comic-stats' }, async $ => ({ text: await stats($) }))

  on('command.run', { command: 'comic-hub' }, async ($, e) => {
    const remove = /^remove\s+(\d+)$/.exec(e.args.trim())
    if (remove) {
      const n = Number(remove[1])
      if (n < 1 || n > hub.items.length) return { text: `No keepsake ${n}: the hub has ${hub.items.length}.` }
      const gone = hub.items[n - 1]!
      hub.items = hub.items.filter((_, i) => i !== n - 1)
      await $.store.set(HUB_STORE_KEY, hub.items)
      stage.home.setItems(hub.items)
      return { text: `Removed the ${gone.kind} "${gone.label}".` }
    }
    if (!hub.items.length) return { text: 'The hub has no keepsakes yet. Claude adds one after a real milestone.' }
    const lines = hub.items.map((h, i) => `${i + 1}. ${h.kind}: ${h.label} (${new Date(h.at).toISOString().slice(0, 10)})`)
    return { text: `Keepsakes in the hub, oldest first:\n${lines.join('\n')}\n\nRemove one with /comic-hub remove <n>.` }
  })

  // a pat: the ♥ at the band's edge, or /comic-pet
  on('ui.press', { element: PET_KEY }, async $ => {
    givePat($)
    return { element: PET_KEY }
  })

  on('command.run', { command: 'comic-pet' }, async $ => {
    givePat($)
    return { text: 'A headpat, on its way.' }
  })

  on('command.run', { command: 'comic-feel' }, async ($, e) => {
    const mood = FEELINGS.find(m => m === e.args.trim().toLowerCase())
    if (!mood) return { text: `Usage: /comic-feel <mood>, one of: ${FEELINGS.join(', ')}` }
    stage.interject([feelBeat(mood)])
    await showFor($, FEEL_MS)
    return { text: `Claude is ${mood}.` }
  })
}

/** The comic's own tool: Claude keeps a milestone in the hub. */
function registerHub(on: On) {
  on('tool.call', { tool: HUB_TOOL_NAME }, async ($, e) => {
    if (hub.added >= MAX_HUB_ADDS) return { result: 'Not added: the hub already got its keepsake this session. Keep the next one for another milestone.' }
    const item = hubItemFrom(e, Date.now())
    if ('error' in item) return { result: `Not added: ${item.error}.` }
    hub.added++
    const { items, retired } = addHubItem(hub.items, item)
    hub.items = items
    await $.store.set(HUB_STORE_KEY, hub.items)
    stage.home.setItems(hub.items.slice(0, -1))
    stage.home.addItem(item)
    const room = retired ? ` The hub holds ${MAX_HUB_ITEMS}, so the oldest, the ${retired.kind} "${retired.label}", was retired.` : ''
    return { result: `Added a ${item.kind} "${item.label}" to the hub; it is there whenever Claude Code starts.${room}` }
  })
}

/** A turn, from the person's prompt to its end: what the agent does goes to the director and the stage. */
function registerTurns(on: On) {
  on('prompt.submit', async ($, e, next) => {
    // our own headpat (should a hook of ours see it): its turn is told apart as it starts, below
    const origin = e.origin as { kind?: string; name?: string } | undefined
    if (origin?.kind === 'plugin' && origin.name === 'agent-comic') return next(e)
    linger?.cancel()
    // typed over the running turn, or delivered into it: the same story goes on
    if (e.turnId !== undefined) {
      addToTurn(e.text)
      return next(e)
    }
    clearFinishedTasks()
    beginTurn($, e.text)
    await sync($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    // a subagent's own tool calls: its small Claude acts them out
    if (e.agentId) stage.helpers.activity(e.agentId, e.tool)
    // a subagent started from the main thread: a small Claude walks in, and reports back when it is done
    const isHelper = e.tool === 'Agent' && !e.agentId
    if (isHelper) {
      const label = typeof input.description === 'string' ? input.description : 'helper'
      stage.helpers.start(e.tool_use_id, label, input.run_in_background === true)
    }
    // the main thread's own calls: a mark over Claude's head at once, while the director catches up
    const isMain = !e.agentId && !isHelper
    if (isMain) {
      const cue = CUES[e.tool]
      if (cue) stage.cue(cue)
      toolStarted(e.tool_use_id, describeCall(input, {}))
      // a question for the person: he turns to them until it is answered
      if (ASKS_PERSON.has(e.tool)) stage.attention = 'question'
    }
    const startedAt = Date.now()
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } finally {
      toolEnded(e.tool_use_id)
      // answered (a question, or a permission prompt on the way): back to the story
      if (isMain) stage.attention = null
    }
    if (isMain) {
      if (ran.isError || ran.deny) stage.cue('fail')
      observe(input, ran, act)
    }
    if (isHelper) {
      // back within a few seconds: it was only launched and works on in the background
      if (input.run_in_background === true || Date.now() - startedAt < 5000) stage.helpers.background(e.tool_use_id)
      else stage.helpers.done(e.tool_use_id)
    }
    note(describeCall(input, ran))
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
    stage.helpers.doneByAgent(e.agent_id)
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door === 'response' && !e.agentId && !pats.isAnswering) {
      const text = e.message.content
        .map(b => (b.type === 'text' ? b.text : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) heard(text)
    }
    return stored
  })

  // the turn answering a pat: he stays where he is, glowing, while Claude answers; no world, no scenes
  on('turn.start', async ($, e, next) => {
    if (pats.claim(e.text)) {
      pats.isAnswering = true
      await sync($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // a subagent's turn ends inside the main one: its small Claude reports through SubagentStop
    if (e.agentId) return done
    if (pats.isAnswering) {
      pats.isAnswering = false
      await sync($)
      return done
    }
    endTurn($, e.reason === 'aborted')
    await lingerFor($, LINGER_MS)
    return done
  })
}

/**
 * The band above the prompt: the stage, a ♥ beside it to give Claude a pat (a Raster takes no clicks
 * of its own: a click reaches the ♥ in the fullscreen terminal; anywhere, ctrl+x tab focuses the band
 * and p presses it), and between turns the signs to the places beside the hub.
 */
function registerBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isOn = await isEnabled($)
    const rows = Math.min(MAX_ROWS, e.props.maxRows - 1)
    // always up while on: Claude idles between turns (no model calls then) and dozes off after a while
    const isLingeringNow = settings.showWhenIdle || (await isLingering($))
    const isShown = isOn && !e.props.hasSurvey && rows >= MIN_ROWS && (e.props.isWorking || isLingeringNow)
    // between turns, with places on the ring: one of them may have the band, or the hub shows signs to them
    const ring = await stops($)
    const isBetween = ring.length > 1 && !e.props.isWorking && !(await isLingering($))
    const at = isBetween ? await whereNow($) : null
    const isAtPlace = at !== null && ring.some(s => s.id === at)

    const elements = $.ui.resolve(e)
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    if (!isShown || isAtPlace || (e.surface !== 'terminal' && !Svg)) {
      hideBand(e.surface)
      stage.routeSigns = null
      return next(e)
    }
    const route = isBetween ? routeOf(ring, null) : null
    stage.routeSigns = route ? { left: route.left?.name ?? null, right: route.right?.name ?? null } : null

    const columns = Math.max(20, Math.min(512, e.props.bodyColumns - 5))
    const { Box, Button } = elements
    let picture
    if (Svg) {
      picture = (
        <Svg
          source={desktopChunk(e.requestId, Math.min(columns, 160), rows)}
          alt="A little Claude acting out what the agent is doing"
          {...(getSvgMode() === 'frame' ? { isInteractive: true } : {})}
        />
      )
    } else {
      if (!('Raster' in elements)) return next(e)
      const { Raster } = elements
      picture = <Raster key={RASTER_KEY} columns={columns} rows={rows} cells={terminalCells(e.requestId, columns, rows)} />
    }
    return (
      <Box flexDirection="row">
        {picture}
        <Box flexDirection="column" paddingLeft={1}>
          <Button key={PET_KEY} plain hotkey="p" onPress={() => undefined}>♥</Button>
          {route?.left ? <Button key={SIGN_LEFT} plain hotkey="a" onPress={() => undefined}>◂</Button> : null}
          {route?.right ? <Button key={SIGN_RIGHT} plain hotkey="d" onPress={() => undefined}>▸</Button> : null}
        </Box>
      </Box>
    )
  })
}
