// The animation: plays a scene's beats with the Claude figure and draws each frame.

import { Canvas, DEFAULT, cellText } from './canvas'
import type { Beat, Hat, Mood, Prop, Scene } from './scene'
import { BALLOON, BITS, HATS_ART, MINI_HEIGHT, MINI_WIDTH, miniClaude, CLAUDE_HEIGHT, MOOD_ICONS, CLAUDE_WIDTH, FLAG_WAVE, LOOKS, ORANGE, P, PROPS, SKY_ART, TINTS, bookColor, claude } from './sprites'
import type { Arm, Face, Look, Tint } from './sprites'
import type { HubItem } from './hub'
import {
  BED, BED_HEAD_X, BED_OVER, CLOUD, COUCH_BACK, COUCH_FRONT, DEN_LOOK, DOOR, FLOWER_COLORS, FLOWER_STAGES, GARDEN_LOOK, HUB_ART, HUB_LOOK,
  RAIN, RAIN_CLOUD, SLEEP_CAP, TV, TV_SCREEN, WATERING_CAN, claudeLying, flowerPalette,
} from './hubart'

const MAX_HELPERS = 3 // small Claudes (subagents) on screen at once
const DOZE_MS = 120_000 // idle this long and Claude falls asleep (or, between turns, goes home)
const HOME_DOZE_MS = 15_000 // back home, he naps soon
const DOOR_WIDTH = DOOR.closed[0]!.length
const HUB_GAP = 5 // columns between two keepsakes
const MAX_SCENE_MS = 30_000
const CUT_AFTER = 3 // beats a scene plays before news may end it at its next pause
const MAX_PLANTED_SIGNS = 2 // a scene this old gives way to a waiting one mid-play
const BUBBLE = { fg: P.sand, bg: P.wine, border: ORANGE }
const THOUGHT = { fg: P.silver, bg: P.night, border: P.mist }
const SIGN = { fg: P.white, bg: P.bark, border: P.tan }
const CALL = { fg: P.ink, bg: P.yellow, border: P.amber } // "needs you": the one loud thing on the stage
const PENNANT = { rows: ['phh', 'pyy', 'p..', 'p..', 'p..'], palette: { p: P.silver, h: P.yellow, y: P.amber } }
const GOAL_FLAG = { rows: ['phh', 'prr', 'p..', 'p..'], palette: { p: P.silver, h: P.coral, r: P.red } }
const GOAL_FLAG_DONE = { rows: ['phh', 'pyy', 'p..', 'p..'], palette: { p: P.silver, h: P.yellow, y: P.amber } }
const BALLOON_UP = { rows: ['.r.', 'rhr', 'rrr', '.r.', '.s.', 's..'], palette: { r: P.red, h: P.coral, s: P.silver } }

/** The hub's rooms, left to right; the door to the turn's world stands in each of them. */
const ROOMS = ['garden', 'hall', 'den'] as const
export type Room = (typeof ROOMS)[number]
const ROOM_LOOK: Record<Room, Look> = { garden: GARDEN_LOOK, hall: HUB_LOOK, den: DEN_LOOK }
/** What he does at home while nothing calls him away: a calm round at random, like a screensaver. */
export type Pastime = 'admire' | 'tend' | 'rest' | 'movie'
const PASTIMES: Record<Pastime, { room: Room; weight: number; secs: [number, number] }> = {
  admire: { room: 'hall', weight: 2, secs: [15, 30] },
  tend: { room: 'garden', weight: 3, secs: [25, 45] },
  rest: { room: 'den', weight: 2, secs: [30, 60] },
  movie: { room: 'den', weight: 3, secs: [30, 60] },
}
const HOME_PACE = 0.6 // he strolls about at home
const FLOWER_COUNT = 5
const FLOWER_STEP = 7 // columns from one flower to the next
const WATER_SECS = 5 // one flower's watering
const SIT_LIFT = 2 // seated on the couch he sits this many pixels up, his legs behind its front

/** The session's sky, kept quiet: the local hour, and weather that follows how the work goes. */
export type Weather = 'clear' | 'cloudy' | 'rain'
export type Ambience = { hour: number; weather: Weather }
/** Why Claude needs the person: a permission prompt, or a question put to them. */
export type Attention = 'permission' | 'question'

/** How each mood shows: the face it wears, its tint, and what it gives off per second. */
const MOOD_LOOK: Record<Mood, { face: Face; tint: Tint; effect?: Effect['kind']; rate?: number }> = {
  neutral: { face: 'ahead', tint: 'normal' },
  happy: { face: 'happy', tint: 'normal', effect: 'sparkle', rate: 1 },
  proud: { face: 'happy', tint: 'normal', effect: 'sparkle', rate: 3 },
  love: { face: 'happy', tint: 'normal', effect: 'heart', rate: 1.3 },
  sad: { face: 'sad', tint: 'sad', effect: 'tear', rate: 0.9 },
  angry: { face: 'angry', tint: 'angry', effect: 'steam', rate: 4 },
  surprised: { face: 'wide', tint: 'normal' },
  confused: { face: 'confused', tint: 'normal' },
  sleepy: { face: 'shut', tint: 'normal', effect: 'zzz', rate: 0.7 },
  focused: { face: 'focused', tint: 'normal' },
  worried: { face: 'ahead', tint: 'normal', effect: 'sweat', rate: 0.7 },
}

/** How busy the stage is: walk speed, and how long the rests between actions last. */
export type Pace = { walk: number; rest: number }
export const PACES: Record<'calm' | 'normal' | 'lively', Pace> = {
  calm: { walk: 9, rest: 1 },
  normal: { walk: 12, rest: 0.6 },
  lively: { walk: 15, rest: 0.3 },
}

/** A subagent at work: a small Claude that walks in, mirrors its tool calls, and reports back. */
type Helper = {
  id: string
  agentId?: string
  label: string
  x: number
  facing: 1 | -1
  target: number | null
  state: 'arriving' | 'working' | 'leaving' | 'reporting'
  activity: 'read' | 'type' | 'dig' | null
  activityUntil: number
  born: number
  lastActive: number
  isBackground: boolean
  reportAt: number
  moving: boolean
}

type Run = { beat: Beat; start: number; phase: number; phaseAt: number; fromX?: number; target?: number }
type Particle = { x: number; y: number; vx: number; vy: number; until: number; color: number }

type Effect =
  | { kind: 'sparkle'; x: number; y: number; color: number; start: number; until: number }
  | { kind: 'poof' | 'heart' | 'tear' | 'steam' | 'sweat' | 'zzz' | 'dust' | 'balloon'; x: number; y: number; start: number; until: number }

const EMPTY: Scene = { setting: 'meadow', mood: 'neutral', props: [], beats: [] }

export class Stage {
  constructor(private readonly rand: () => number = Math.random) {}

  /** Walk speed and rest length; /config's pace sets it. */
  pace: Pace = PACES.calm
  private helpers: Helper[] = []

  private scene: Scene = EMPTY
  private waiting: Scene[] = [] // scenes queued to play, oldest first
  private index = 0
  private run: Run | null = null
  private removed = new Set<string>()
  private placed = new Map<string, number>() // props moved by carry/drop: their column
  private carrying: string | null = null

  private x = 4
  private facing: 1 | -1 = 1
  private lift = 0
  private looking = false
  private bob = 0
  private wanderAt = 0
  private wanderTo: number | null = null
  private moving = false
  private emote: { mood: Mood; until: number } | null = null
  private balloon: { mood: Mood; until: number } | null = null
  private spriteTop: number | null = null
  private idleSince: number | null = null
  private restUntil = 0 // a breath between two actions
  private sceneStart = 0
  private isPendingUrgent = false
  /** A sign being hammered in, wobbled loose or pulled out: how its drawing moves. */
  private bubbleArea: Rect | null = null // what the bubble covers this frame
  private planted = new Set<string>() // signs Claude hammered in this turn
  private signMotion = new Map<string, { kind: 'grow' | 'shake' | 'rise'; start: number; ms: number }>()

  private bubble: { text: string; kind: 'say' | 'think'; until: number } | null = null
  private react: { glyph: string; until: number } | null = null
  private cueMark: { glyph: string; color: number; until: number } | null = null
  private dirt: Particle[] = []
  private effects: Effect[] = []

  private columns = 80
  private rows = 8
  private last = 0
  private now = 0

  /** Set while Sonnet is drawing the next scene: a thought bubble of dots. */
  pondering = false

  /** The hour and the weather the sky shows (outdoor settings only, and only a little). */
  ambience: Ambience = { hour: 12, weather: 'clear' }
  /** The agent's task list: a trail along the ground, lit as tasks are done. */
  progress: { done: number; total: number } | null = null

  // home: the hub, its keepsakes and the door to the turn's world
  private isHome = false
  private isAway = false // through the door, the turn's world not yet loaded
  private isNapping = false // came home after a long idle: he naps soon
  private hidden = false
  private homeItems: HubItem[] = []
  private leaving: { phase: 'wake' | 'walk' | 'open' | 'in'; at: number; isSprint: boolean } | null = null
  private doorOpenUntil = 0
  /** A door Claude summoned into the world: he walks through it into new scenery, queued behind it. */
  private portal: { col: number; phase: 'appear' | 'walk' | 'open' | 'in'; at: number } | null = null
  private newItem: { at: number; item: HubItem } | null = null
  private pennants: number[] = [] // commits: little flags planted in this world, by column
  private homeLabels: { col: number; row: number; text: string; color: number }[] = [] // drawn over the figure

  private room: Room = 'hall'
  private pastime: { kind: Pastime; phase: 'go' | 'do'; until: number; next: number; flower: number } | null = null
  private lastPastime: Pastime | null = null
  private nextPastime: Pastime | null = null // asked for: home after a long idle he goes to bed
  private pastimeAt = -1 // when the next may start; -1: a few seconds after the first step at home
  private trip: { to: Room; dir: 1 | -1 } | null = null
  private flowers: { stage: number; color: number }[] = []

  private calling: Attention | null = null
  private callingSince = 0

  /** Called as a queued scene begins to play. */
  onPlay: ((scene: Scene) => void) | null = null
  /** Called once the world on stage changed: a prop transformed, a new hat, new scenery stepped into. */
  onWorldChange: ((world: { setting: Scene['setting']; props: Prop[]; hat: Hat }) => void) | null = null

  private tellWorld() {
    const props = this.scene.props.filter(p => !this.removed.has(p.id)).map(p => ({ ...p }))
    this.onWorldChange?.({ setting: this.scene.setting, props, hat: this.scene.hat ?? 'none' })
  }

  /** The figure's column, for tools that follow it. */
  get figureColumn() {
    return Math.round(this.x)
  }

  /** How long the figure has had nothing left to play (0 while a beat runs or a scene waits). */
  get idleMs(): number {
    return this.idleSince === null || this.waiting.length ? 0 : this.now - this.idleSince
  }

  /**
   * Plays `scene` once the current one has finished (or run past MAX_SCENE_MS),
   * so stories end before the next begins; `urgent` (the person's own commands) cuts in.
   */
  queue(scene: Scene, urgent = false) {
    if (!scene.continues) this.waiting = [] // a new world supersedes everything queued for the old one
    this.waiting.push(scene)
    // keep the queue short: drop the oldest continuation, never a scene that sets up a world
    while (this.waiting.length > 3) this.waiting.splice(this.waiting[0]!.continues ? 0 : 1, 1)
    if (urgent) this.isPendingUrgent = true
  }

  /**
   * About how long until everything playing and queued has played out (ms): the
   * beats left, the walks between them and the rests after them. Close, not exact.
   */
  get remainingMs(): number {
    return this.left(false)
  }

  /**
   * About how long until a scene of news queued now would start (ms): the playing
   * scene gives way at its first pause after CUT_AFTER beats with nothing in hand.
   * With a scene already waiting, that one goes first and plays out.
   */
  get untilFreeMs(): number {
    return this.waiting.length ? this.left(false) : this.left(true)
  }

  private left(isCut: boolean): number {
    let x = this.x
    const span = Math.max(1, this.columns - CLAUDE_WIDTH)
    // each beat's own time, and the walk to where it happens
    const beatSecs = (b: Beat, scene: Scene, isCurrent: boolean): number => {
      const colOf = (id: string) => {
        const p = scene.props.find(q => q.id === id)
        if (!p || (isCurrent && this.removed.has(id))) return null
        return isCurrent ? this.col(p.x, p.id) : (p.x / 100) * span
      }
      const go = (to: number | null, speed = this.pace.walk) => {
        if (to === null) return 0
        const d = Math.abs(clamp(to, 0, this.maxX()) - x)
        x = clamp(to, 0, this.maxX())
        return d / speed
      }
      const at = 'at' in b && b.at ? colOf(b.at) : null
      switch (b.do) {
        case 'walk': return go(isCurrent ? this.col(b.to) : (b.to / 100) * span)
        case 'run': return go(isCurrent ? this.col(b.to) : (b.to / 100) * span, this.pace.walk * 2.4)
        case 'say':
        case 'think': return b.secs ?? sayTime(b.text)
        case 'look': return go(at) + 1.8
        case 'squash': return go(at) + 0.6
        case 'carry': return go(at) + 0.4
        case 'type': return go(at) + (b.secs ?? 2.5)
        case 'drop': return 0.4
        case 'transform': return go(at) + 2.1
        case 'plant_sign': return go(isCurrent ? this.col(b.x) : (b.x / 100) * span) + 2.4
        case 'pull_sign': return go(at) + 2.1
        case 'read': return b.secs ?? 3
        case 'emote': return b.secs ?? 3.5
        case 'ponder': return b.secs ?? 3
        case 'dance': return b.secs ?? 2.5
        case 'wave': return 1.6
        case 'shrug': return 1.3
        case 'jump': return 0.6
        case 'celebrate': return 1.6
        case 'dig': return b.secs ?? 2
        case 'wait': return b.secs
        case 'hat': return 1.4
        case 'travel': return 6
      }
    }
    const rest = (b: Beat) => restAfter(b, 0.5) * this.pace.rest
    const sceneMs = (scene: Scene, from: number, isCurrent: boolean) => {
      let ms = 0
      // what he holds by each pause, as the beats will leave it
      let holds = isCurrent && (this.carrying !== null || this.run?.beat.do === 'carry')
      if (isCurrent && this.run && (this.run.beat.do === 'drop' || this.run.beat.do === 'transform')) holds = false
      for (let i = from; i < scene.beats.length; i++) {
        if (isCut && isCurrent && i >= CUT_AFTER && !holds) break
        const b = scene.beats[i]!
        ms += beatSecs(b, scene, isCurrent) * 1000 + rest(b)
        if (b.do === 'carry') holds = true
        if (b.do === 'drop' || b.do === 'transform') holds = false
      }
      return ms
    }

    let current = Math.max(0, this.restUntil - this.now)
    if (this.run) {
      // the beat under way: what is left of it, roughly
      current = Math.max(0, beatSecs(this.run.beat, this.scene, true) * 1000 - (this.now - this.run.start)) + rest(this.run.beat)
    }
    current += sceneMs(this.scene, this.index, true)
    if (this.index < this.scene.beats.length || this.run) {
      current = Math.min(current, Math.max(0, MAX_SCENE_MS - (this.now - this.sceneStart)))
    }
    let total = current
    for (const scene of this.waiting) total += Math.min(MAX_SCENE_MS, sceneMs(scene, 0, false))
    return Math.round(total)
  }

  /**
   * A tool the agent just started (or one that failed): a small mark over Claude's
   * head at once, while the director is still staging it. He does not stop what he is doing.
   */
  cue(kind: 'read' | 'search' | 'edit' | 'run' | 'web' | 'fail') {
    const marks = {
      read: { glyph: '≡', color: P.silver },
      search: { glyph: '⌕', color: P.silver },
      edit: { glyph: '✎', color: P.silver },
      run: { glyph: '»', color: P.silver },
      web: { glyph: '◌', color: P.silver },
      fail: { glyph: '!', color: P.coral },
    }
    // a failure stays up through the cues of the calls after it
    if (this.cueMark?.glyph === '!' && kind !== 'fail' && this.cueMark.until > this.now) return
    this.cueMark = { ...marks[kind], until: this.now + (kind === 'fail' ? 2200 : 1400) }
    if (kind === 'fail') this.give('sweat')
  }

  /** Plays `beats` next in the current world, then idles. */
  interject(beats: Beat[]) {
    this.waiting.unshift({ ...this.scene, mood: 'neutral', beats, continues: true })
    this.isPendingUrgent = true
  }

  /**
   * The world moves to new scenery (the director's travel beat): whatever he was doing, he stops,
   * a door appears beside him with a puff, he walks through it and steps out into `scene` from the left.
   * At home (or already on his way through a door) the new world simply waits to load.
   */
  changeScenery(scene: Scene) {
    this.queue({ ...scene, continues: undefined })
    if (this.isHome || this.isAway || this.leaving || this.portal) return
    if (this.carrying) this.putDown()
    this.run = null
    this.bubble = null
    this.lift = 0
    this.bob = 0
    this.looking = false
    const ahead = this.facing > 0 ? this.x + CLAUDE_WIDTH + 6 : this.x - DOOR_WIDTH - 6
    const room = Math.max(0, this.columns - DOOR_WIDTH - 1)
    const col = ahead >= 1 && ahead <= room ? Math.round(ahead) : clamp(Math.round(this.facing > 0 ? this.x - DOOR_WIDTH - 6 : this.x + CLAUDE_WIDTH + 6), 1, room)
    this.portal = { col, phase: 'appear', at: this.now }
    this.facing = col > this.x ? 1 : -1
    this.emote = { mood: 'surprised', until: this.now + 900 }
    const ground = this.rows * 2 - 2
    this.give('poof', col + Math.floor(DOOR_WIDTH / 2) - 1, ground - DOOR.closed.length)
    for (let k = 0; k < 4; k++) this.give('sparkle', col + Math.round(this.rand() * DOOR_WIDTH))
  }

  /** True while a summoned door is up or he is going through it. */
  get isTravelling(): boolean {
    return this.portal !== null
  }

  /** At home, the room he is in and what he is doing there (`hall:admire`); null away. */
  get homeDoing(): string | null {
    return this.isHome ? `${this.room}:${this.trip ? 'walking' : this.pastime?.kind ?? 'idle'}` : null
  }

  /** True at home: the hub, before the first turn or after a long idle. */
  get home(): boolean {
    return this.isHome
  }

  /** The keepsakes on show at home, oldest first. */
  setHome(items: readonly HubItem[]) {
    this.homeItems = [...items]
  }

  /** A new keepsake: if Claude is home it pops in with a sparkle, its label up for a while. */
  addHomeItem(item: HubItem) {
    this.homeItems = [...this.homeItems, item]
    if (!this.isHome) return
    this.newItem = { at: this.now, item }
    this.nextPastime = 'admire'
    const spot = this.homeSpots().find(h => h.item === item)
    for (let k = 0; k < 5; k++) this.give('sparkle', spot ? spot.col + 3 + Math.round(this.rand() * 4 - 2) : undefined)
  }

  /** The session opens at home, Claude standing by. */
  startHome() {
    this.settleHome()
    this.x = clamp(this.doorCol() - CLAUDE_WIDTH - 2, 0, this.maxX())
  }

  /** Idle long enough between turns, and not home yet: time to go home. */
  get wantsHome(): boolean {
    return !this.isHome && !this.leaving && !this.portal && this.idleMs >= DOZE_MS - 1500
  }

  /** Back home through the door: it swings open and he steps out, to nap there soon. */
  goHome() {
    if (this.isHome || this.leaving) return
    this.settleHome()
    this.x = this.doorSpot()
    this.facing = -1
    this.doorOpenUntil = this.now + 900
    this.isNapping = true
    this.nextPastime = 'rest'
  }

  /**
   * A new turn while home: he sprints for the door and goes through (the turn's world
   * loads once he is in, so he never keeps it waiting); woken from a nap, he starts up first.
   * False when he is not home (nothing to do).
   */
  leaveHome(): boolean {
    if (!this.isHome || this.leaving) return false
    const isWaking = this.isDozing || this.isResting
    // whatever he was doing at home, he drops it
    this.pastime = null
    this.trip = null
    this.lift = 0
    this.leaving = { phase: isWaking ? 'wake' : 'walk', at: this.now, isSprint: true }
    this.emote = isWaking ? { mood: 'surprised', until: this.now + 700 } : null
    this.wanderTo = null
    return true
  }

  /** Why the person is needed now, if they are: Claude stops, turns to them and waves. */
  get attention(): Attention | null {
    return this.calling
  }

  set attention(why: Attention | null) {
    if (why && !this.calling) this.callingSince = this.now
    if (!why && this.calling) {
      // the scene stood still while he waited: it carries on where it was
      const d = Math.max(0, this.now - this.callingSince)
      if (this.run) {
        this.run.start += d
        this.run.phaseAt += d
      }
      this.restUntil += d
      this.sceneStart += d
      if (this.bubble) this.bubble.until += d
    }
    this.calling = why
  }

  /** A pat from the person: hearts and a love balloon (and, napping, he wakes up for it). */
  pet() {
    if (this.hidden) return
    this.emote = { mood: 'love', until: this.now + 2600 }
    this.balloon = { mood: 'love', until: this.now + 2600 }
    for (let k = 0; k < 3; k++) this.give('heart')
  }

  /** A commit plants a little flag beside him; a push sends a balloon up. */
  gitMoment(kind: 'commit' | 'push') {
    if (kind === 'push') {
      this.give('balloon')
      return
    }
    const col = this.facing > 0 ? this.x - 4 : this.x + CLAUDE_WIDTH + 1
    this.pennants = [...this.pennants, clamp(Math.round(col), 0, Math.max(0, this.columns - 3))].slice(-3)
    this.give('sparkle')
    this.give('sparkle')
  }

  private settleHome() {
    // whatever he was doing in the old world stays there
    this.run = null
    this.bubble = null
    this.emote = null
    this.lift = 0
    this.bob = 0
    this.looking = false
    this.waiting = []
    this.load({ setting: 'meadow', mood: 'neutral', props: [], beats: [] })
    this.isHome = true
    this.isAway = false
    this.hidden = false
    this.leaving = null
    this.isNapping = false
    this.idleSince = null // idle from the next step, on its clock
    this.room = 'hall'
    this.pastime = null
    this.trip = null
    this.pastimeAt = -1
  }

  /** Where he stands to go through the door, or after stepping out of it. */
  private doorSpot() {
    return clamp(this.doorCol() + Math.floor((DOOR_WIDTH - CLAUDE_WIDTH) / 2), 0, this.maxX())
  }

  private doorCol() {
    return clamp(Math.round(this.columns * 0.8) - DOOR_WIDTH, 0, Math.max(0, this.columns - DOOR_WIDTH - 1))
  }

  /** The keepsakes that fit left of the door, newest kept, laid out oldest first. */
  private homeSpots(): { item: HubItem; col: number }[] {
    const fit = Math.max(0, Math.floor((this.doorCol() - 6) / (7 + HUB_GAP)))
    if (fit === 0) return []
    return this.homeItems.slice(-fit).map((item, i) => ({ item, col: 3 + i * (7 + HUB_GAP) }))
  }

  /** The summoned door: it appears, he walks to it, it opens, he goes in, and the waiting world loads. */
  private stepPortal() {
    const p = this.portal!
    const since = this.now - p.at
    if (p.phase === 'appear' && since >= 900) this.portal = { ...p, phase: 'walk', at: this.now }
    else if (p.phase === 'open' && since >= 500) {
      this.hidden = true
      this.portal = { ...p, phase: 'in', at: this.now }
    } else if (p.phase === 'in' && since >= 600) {
      this.portal = null
      const next = this.waiting.findIndex(s => !s.continues)
      if (next < 0) {
        this.hidden = false
        return
      }
      this.waiting.splice(0, next)
      // stepping out of a door, like coming from home: in from the left
      this.isAway = true
      this.load(this.waiting.shift()!)
      this.tellWorld()
    }
  }

  private stepLeaving(dt: number) {
    const l = this.leaving!
    const next = (phase: 'walk' | 'open' | 'in') => {
      this.leaving = { ...l, phase, at: this.now }
    }
    if (l.phase === 'wake') {
      // a start: a little jump, eyes wide, then off
      const t = (this.now - l.at) / 1000
      this.lift = t < 0.35 ? Math.sin((Math.PI * t) / 0.35) * 2 : 0
      if (t >= 0.6) next('walk')
    } else if (l.phase === 'walk') {
      const isThere = this.walk(this.doorSpot(), dt, l.isSprint ? this.pace.walk * 2.4 : this.pace.walk)
      if (l.isSprint && !isThere && this.rand() < 12 * dt) this.give('dust')
      if (isThere) {
        this.facing = 1
        next('open')
      }
    } else if (l.phase === 'open' && this.now - l.at >= 500) {
      this.hidden = true
      next('in')
    } else if (l.phase === 'in' && this.now - l.at >= 500) {
      this.leaving = null
      this.isAway = true
    }
  }

  /**
   * The turn's world as the next scene will find it: the props of the newest queued
   * world-setting scene, else the current props with their moves, changes and losses.
   */
  world(): { setting: Scene['setting']; props: Prop[]; gone: string[]; hat: Hat } {
    const fresh = [...this.waiting].reverse().find(s => !s.continues)
    if (fresh) return { setting: fresh.setting, props: fresh.props.map(p => ({ ...p })), gone: [], hat: fresh.hat ?? 'none' }
    const span = Math.max(1, this.columns - CLAUDE_WIDTH)
    const props = this.scene.props
      .filter(p => !this.removed.has(p.id))
      .map(p => ({ ...p, x: Math.round((this.col(p.x, p.id) / span) * 100) }))
    return { setting: this.scene.setting, props, gone: [...this.removed], hat: this.scene.hat ?? 'none' }
  }

  private mood(): Mood {
    // long idle (no scene for a while, e.g. between turns): he dozes off until the next scene
    if (this.isDozing || this.isResting) return 'sleepy'
    return this.emote?.mood ?? this.scene.mood
  }

  private get isDozing(): boolean {
    return !this.emote && !this.run && !this.leaving && !this.calling && !this.pastime && !this.trip && this.idleMs >= (this.isHome && this.isNapping ? HOME_DOZE_MS : DOZE_MS)
  }

  /** Advances the animation to `now` (ms). */
  step(now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0
    this.last = now
    this.now = now
    this.moving = false

    this.dirt = this.dirt.filter(p => p.until > now)
    for (const p of this.dirt) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 40 * dt
    }
    this.effects = this.effects.filter(e => e.until > now)
    if (this.bubble && this.bubble.until < now) this.bubble = null
    if (this.react && this.react.until < now) this.react = null
    if (this.cueMark && this.cueMark.until < now) this.cueMark = null
    if (this.emote && this.emote.until < now) this.emote = null
    if (this.balloon && this.balloon.until < now) this.balloon = null
    if (this.newItem && now - this.newItem.at > 6000) this.newItem = null

    // waiting on the person: he holds still (the scene with him) until they have answered
    if (this.calling) {
      this.stepHelpers(dt)
      return
    }
    if (this.leaving) {
      this.stepLeaving(dt)
      this.stepHelpers(dt)
      return
    }
    if (this.portal) {
      this.stepPortal()
      if (this.portal?.phase === 'walk' && this.walk(this.portal.col + Math.floor((DOOR_WIDTH - CLAUDE_WIDTH) / 2), dt)) {
        this.facing = 1
        this.portal = { ...this.portal, phase: 'open', at: now }
      }
      this.stepHelpers(dt)
      return
    }

    if (this.run && this.isDone(this.run)) {
      // a breath between actions: longer after handling things or finding something
      this.restUntil = now + restAfter(this.run.beat, this.rand()) * this.pace.rest
      this.run = null
      this.lift = 0
      this.bob = 0
      this.looking = false
    }
    if (!this.run && (now >= this.restUntil || this.isPendingUrgent)) {
      const isSceneOver = this.index >= this.scene.beats.length || now - this.sceneStart > MAX_SCENE_MS
      // news waiting: a scene that has had its say gives way at this pause, as long as his hands are free
      const isYielding = this.waiting[0]?.isNews === true && this.index >= CUT_AFTER && this.carrying === null
      const next = this.waiting[0]
      if (next && (isSceneOver || isYielding || this.isPendingUrgent)) this.load(this.waiting.shift()!)
      const beat = now >= this.restUntil || this.index === 0 ? this.scene.beats[this.index] : undefined
      if (beat) {
        this.index++
        this.run = { beat, start: now, phase: 0, phaseAt: now }
        this.idleSince = null
      } else if (this.idleSince === null) {
        this.idleSince = now
      }
    }

    if (this.run) this.play(this.run, dt)
    else if (this.isHome && !this.isAway) this.stepHome(dt)
    else if (now >= this.restUntil) this.idle(dt)
    this.stepHelpers(dt)

    // what the mood gives off, at its rate
    const look = MOOD_LOOK[this.mood()]
    if (look.effect && look.rate && this.rand() < look.rate * dt) this.give(look.effect)
  }

  private load(scene: Scene) {
    if (scene.continues) {
      // same world: keep its props as they now are (moved, transformed, squashed)
      scene = { ...scene, setting: this.scene.setting, props: this.scene.props, hat: this.scene.hat }
    } else {
      scene = { ...scene, props: scene.props.map(p => ({ ...p })) }
      if (this.isHome || this.isAway) {
        // out of the door and into the turn's world, stepping in from the left
        this.isHome = false
        this.isAway = false
        this.hidden = false
        this.x = 2
        this.facing = 1
        this.give('dust', 3, this.rows * 2 - 3)
      }
      this.pennants = []
      this.removed.clear()
      this.placed.clear()
      this.planted.clear()
      this.signMotion.clear()
      this.carrying = null
    }
    this.scene = scene
    if (!scene.continues) this.arrange()
    this.isPendingUrgent = false
    this.sceneStart = this.now
    this.restUntil = 0
    this.index = 0
    this.emote = null
    // a new scene announces its mood once, in a balloon
    this.balloon = scene.mood === 'neutral' ? null : { mood: scene.mood, until: this.now + 2500 }
    this.onPlay?.(scene)
  }

  private secs(run: Run) {
    return (this.now - run.start) / 1000
  }

  private isDone(run: Run): boolean {
    const t = this.secs(run)
    const b = run.beat
    switch (b.do) {
      case 'walk':
      case 'run': return Math.abs(this.x - this.target(this.col(b.to))) < 0.5
      case 'say':
      case 'think': return t >= (b.secs ?? sayTime(b.text))
      case 'look':
      case 'squash':
      case 'carry':
      case 'type': return run.phase === 2
      case 'drop': return t >= 0.4
      case 'transform': return run.phase === 4
      case 'plant_sign': return run.phase === 2
      case 'pull_sign': return run.phase === 3
      case 'read': return t >= (b.secs ?? 3)
      case 'emote': return t >= (b.secs ?? 3.5)
      case 'ponder': return t >= (b.secs ?? 3)
      case 'dance': return t >= (b.secs ?? 2.5)
      case 'wave': return t >= 1.6
      case 'shrug': return t >= 1.3
      case 'jump': return t >= 0.6
      case 'celebrate': return t >= 1.6
      case 'dig': return t >= (b.secs ?? 2)
      case 'wait': return t >= b.secs
      case 'hat': return t >= 1.4
      case 'travel': return true // the door takes over: changeScenery ends the beat itself
    }
  }

  private play(run: Run, dt: number) {
    const b = run.beat
    const t = this.secs(run)
    switch (b.do) {
      case 'walk':
        this.walk(this.col(b.to), dt)
        break
      case 'run':
        if (!this.walk(this.col(b.to), dt, this.pace.walk * 2.4) && this.rand() < 12 * dt) this.give('dust')
        break
      case 'say':
      case 'think':
        if (run.phase === 0) {
          const secs = b.secs ?? sayTime(b.text)
          this.bubble = { text: b.text, kind: b.do, until: this.now + (secs + 4) * 1000 }
          run.phase = 1
        }
        break
      case 'look':
      case 'squash':
      case 'carry':
      case 'type': {
        const prop = 'at' in b && b.at ? this.prop(b.at) : undefined
        if (run.phase === 0) {
          if ('at' in b && b.at && !prop) {
            run.phase = 2
            break
          }
          if (!prop || this.approach(prop, dt)) {
            run.phase = 1
            run.phaseAt = this.now
            run.fromX = this.x
            if (b.do === 'look') this.react = { glyph: b.react ?? '?', until: this.now + 1600 }
          }
          break
        }
        if (run.phase !== 1) break
        const p = (this.now - run.phaseAt) / 1000
        if (b.do === 'look') {
          this.looking = true
          if (p >= 1.8) run.phase = 2
        } else if (b.do === 'type') {
          this.bob = Math.floor(this.now / 160) % 2
          if (p >= (b.secs ?? 2.5)) run.phase = 2
        } else if (b.do === 'carry') {
          this.lift = Math.min(1, p / 0.4) * 1
          if (p >= 0.4 && prop) {
            this.carrying = prop.id
            run.phase = 2
          }
        } else if (prop) {
          // a hop that lands squarely on top of the bug
          const d = Math.min(1, p / 0.6)
          const onTop = this.col(prop.x, prop.id) + propWidth(prop) / 2 - CLAUDE_WIDTH / 2
          this.x = (run.fromX ?? this.x) + (onTop - (run.fromX ?? this.x)) * d
          this.facing = onTop >= (run.fromX ?? this.x) ? 1 : -1
          // the arc comes down onto the bug's back, not the grass beside it
          const perch = prop.kind === 'sign' ? 0 : PROPS[prop.kind].rows.length
          this.lift = d < 0.5 ? Math.sin(Math.PI * d) * 6 : Math.max(perch, Math.sin(Math.PI * d) * 6)
          if (d >= 1) {
            this.removed.add(prop.id)
            this.give('poof', this.col(prop.x, prop.id) + 2, this.rows * 2 - 5)
            run.phase = 2
          }
        }
        break
      }
      case 'drop':
        if (run.phase === 0) {
          this.putDown()
          run.phase = 1
        }
        break
      case 'plant_sign': {
        // walk beside the spot, hammer the post in with dust on each blow, the board types itself in
        // a free spot near where it was asked for; with no room anywhere, no sign goes up
        if (run.target === undefined) {
          const spot = this.freeCol({ id: b.id, kind: 'sign', x: b.x, label: b.label }, this.col(b.x))
          if (spot === null) {
            run.phase = 2
            break
          }
          run.target = spot
        }
        const at = run.target
        const width = [...b.label].length + 4
        const p = (this.now - run.phaseAt) / 1000
        if (run.phase === 0) {
          const spot = at - CLAUDE_WIDTH - 1 >= 0 ? at - CLAUDE_WIDTH - 1 : at + width + 1
          if (!this.walk(spot, dt)) break
          this.facing = spot < at ? 1 : -1
          const standing = [...this.planted].filter(id => !this.removed.has(id)).length
          if (standing >= MAX_PLANTED_SIGNS || this.scene.props.some(q => q.id === b.id && !this.removed.has(q.id))) {
            run.phase = 2 // no room for another sign (or it already stands): the beat passes
            break
          }
          this.removed.delete(b.id)
          this.planted.add(b.id)
          this.scene.props.push({ id: b.id, kind: 'sign', x: b.x, label: b.label })
          this.placed.set(b.id, at)
          this.signMotion.set(b.id, { kind: 'grow', start: this.now, ms: 2200 })
          run.phase = 1
          run.phaseAt = this.now
        } else if (run.phase === 1) {
          const strike = Math.floor(p / 0.35)
          this.bob = strike % 2
          if (this.bob === 0 && Math.floor((p - dt) / 0.35) !== strike) {
            this.give('dust', at + Math.floor(width / 2) - 2, this.rows * 2 - 3)
          }
          if (p >= 2.4) {
            this.bob = 0
            this.signMotion.delete(b.id)
            run.phase = 2
          }
        }
        break
      }
      case 'pull_sign': {
        // grab the sign, tug it loose, it rises out of the ground and vanishes in a puff
        const prop = this.prop(b.at)
        if (!prop || prop.kind !== 'sign') {
          run.phase = 3
          break
        }
        const p = (this.now - run.phaseAt) / 1000
        if (run.phase === 0) {
          if (this.approach(prop, dt)) {
            run.phase = 1
            run.phaseAt = this.now
            this.signMotion.set(prop.id, { kind: 'shake', start: this.now, ms: 1400 })
          }
        } else if (run.phase === 1) {
          this.bob = Math.floor(p / 0.25) % 2
          if (p >= 1.4) {
            this.bob = 0
            this.lift = 1
            run.phase = 2
            run.phaseAt = this.now
            this.signMotion.set(prop.id, { kind: 'rise', start: this.now, ms: 700 })
          }
        } else if (run.phase === 2 && p >= 0.7) {
          const width = [...(prop.label ?? '?')].length + 4
          this.give('poof', this.col(prop.x, prop.id) + Math.floor(width / 2) - 1, this.rows * 2 - 10)
          this.removed.add(prop.id)
          this.signMotion.delete(prop.id)
          this.lift = 0
          run.phase = 3
        }
        break
      }
      case 'transform': {
        // lift it, a puff of magic smoke overhead, it is something else now, set it down
        const prop = this.carrying === b.at ? this.scene.props.find(p => p.id === b.at) : this.prop(b.at)
        if (!prop) {
          run.phase = 4
          break
        }
        const p = (this.now - run.phaseAt) / 1000
        const next = (phase: number) => {
          run.phase = phase
          run.phaseAt = this.now
        }
        if (run.phase === 0) {
          if (this.carrying === prop.id || this.approach(prop, dt)) next(1)
        } else if (run.phase === 1) {
          this.lift = Math.min(1, p / 0.4)
          if (p >= 0.4) {
            this.carrying = prop.id
            next(2)
          }
        } else if (run.phase === 2 && p >= 0.7) {
          const overhead = (this.spriteTop ?? this.rows * 2 - 9) - 3
          this.give('poof', Math.round(this.x + CLAUDE_WIDTH / 2) - 1, overhead)
          for (let k = 0; k < 4; k++) this.give('sparkle')
          prop.kind = b.into
          prop.label = b.label
          next(3)
          this.tellWorld()
        } else if (run.phase === 3 && p >= 1.0) {
          this.putDown()
          next(4)
        }
        break
      }
      case 'hat':
        // a puff over his head, and he wears the new hat
        if (run.phase === 0) {
          const overhead = (this.spriteTop ?? this.rows * 2 - 9) - 2
          this.give('poof', Math.round(this.x + CLAUDE_WIDTH / 2) - 1, overhead)
          for (let k = 0; k < 3; k++) this.give('sparkle')
          this.scene.hat = b.hat
          this.emote = { mood: 'happy', until: this.now + 1200 }
          run.phase = 1
          this.tellWorld()
        }
        break
      case 'travel': {
        const props = b.props.map(p => ({ ...p }))
        const first = props[0]
        this.changeScenery({
          setting: b.setting, mood: 'neutral', props, hat: b.hat ?? this.scene.hat,
          beats: [{ do: 'emote', mood: 'happy', secs: 1.5 }, ...(first ? [{ do: 'look' as const, at: first.id }] : [])],
        })
        break
      }
      case 'emote':
        if (run.phase === 0) {
          this.emote = { mood: b.mood, until: this.now + (b.secs ?? 3.5) * 1000 }
          this.balloon = b.mood === 'neutral' ? null : { mood: b.mood, until: this.emote.until }
          run.phase = 1
        }
        if (b.mood === 'surprised') this.lift = t < 0.35 ? Math.sin((Math.PI * t) / 0.35) * 2 : 0
        if (b.mood === 'confused') this.facing = Math.floor(t / 0.6) % 2 === 0 ? 1 : -1
        break
      case 'dance':
        this.lift = Math.abs(Math.sin(Math.PI * t * 2)) * 2
        this.facing = Math.floor(t * 2) % 2 === 0 ? 1 : -1
        if (this.rand() < 3 * dt) this.give('sparkle')
        break
      case 'jump':
        this.lift = Math.sin(Math.PI * Math.min(1, t / 0.6)) * 4
        break
      case 'celebrate':
        this.lift = Math.abs(Math.sin((Math.PI * t) / 0.5)) * 3
        if (this.rand() < 0.5) this.give('sparkle')
        break
      case 'dig': {
        // a stroke every 0.5 s: blade down (crouched), then up, flinging a clod over his shoulder
        const isDown = (t % 0.5) < 0.25
        this.bob = isDown ? 1 : 0
        if (!isDown && (t - dt) % 0.5 < 0.25) for (let k = 0; k < 3; k++) this.throwDirt()
        break
      }
      case 'ponder': {
        // stands still, looks one way, then turns to look the other way
        const secs = b.secs ?? 3
        this.looking = Math.floor(t / 1.2) % 2 === 1
        if (run.phase === 0 && t > secs / 2) {
          this.facing = this.facing > 0 ? -1 : 1
          run.phase = 1
        }
        break
      }
      case 'read':
      case 'wave':
      case 'shrug':
      case 'wait':
        break
    }
  }

  private idle(dt: number) {
    this.bob = 0
    if (this.mood() === 'sleepy') return
    if (this.wanderTo !== null) {
      if (this.walk(this.wanderTo, dt * 0.5)) this.wanderTo = null
    } else if (this.now > this.wanderAt) {
      this.wanderAt = this.now + 3000 + this.rand() * 4000
      if (this.rand() < 0.6) this.wanderTo = clamp(this.x + (this.rand() * 16 - 8), 0, this.maxX())
    }
  }

  private get isResting(): boolean {
    return this.isHome && this.pastime?.kind === 'rest' && this.pastime.phase === 'do'
  }

  private get isWatching(): boolean {
    return this.isHome && this.pastime?.kind === 'movie' && this.pastime.phase === 'do'
  }

  private get isTending(): boolean {
    return this.isHome && this.pastime?.kind === 'tend' && this.pastime.phase === 'do'
  }

  /** At home with nothing to play: a pastime, the walk to its room, or a pause between two. */
  private stepHome(dt: number) {
    this.bob = 0
    if (this.trip) return this.stepTrip(dt)
    const p = this.pastime
    if (!p) {
      if (this.pastimeAt < 0) this.pastimeAt = this.now + 4000
      if (this.now < this.pastimeAt) return
      const kind = this.pickPastime()
      this.pastime = { kind, phase: 'go', until: 0, next: 0, flower: Math.floor(this.rand() * FLOWER_COUNT) }
      const room = PASTIMES[kind].room
      if (room !== this.room) this.trip = { to: room, dir: ROOMS.indexOf(room) > ROOMS.indexOf(this.room) ? 1 : -1 }
      return
    }
    if (p.phase === 'go') {
      const spot = this.pastimeSpot(p)
      if (spot === null) return this.endPastime() // no room for it at this width
      if (!this.walk(spot, dt * HOME_PACE)) return
      const [lo, hi] = PASTIMES[p.kind].secs
      p.phase = 'do'
      p.until = this.now + (lo + this.rand() * (hi - lo)) * 1000
      p.next = this.now
      if (p.kind === 'movie' || p.kind === 'tend') this.facing = 1
      return
    }
    if (this.now >= p.until) return this.endPastime()
    switch (p.kind) {
      case 'admire': return this.admire(dt)
      case 'tend': return this.tend(p, dt)
      case 'movie':
        // now and then the film gets a reaction
        if (this.now >= p.next) {
          p.next = this.now + 7000 + this.rand() * 7000
          if (p.next > this.now + 7500) this.react = { glyph: ['!', '?', '♪', '♥'][Math.floor(this.rand() * 4)]!, until: this.now + 1400 }
        }
        return
      case 'rest':
        return
    }
  }

  private endPastime() {
    const p = this.pastime
    if (p?.kind === 'tend') this.flowerTended(p.flower)
    this.lastPastime = p?.kind ?? null
    this.pastime = null
    this.lift = 0
    this.pastimeAt = this.now + 3000 + this.rand() * 5000
  }

  private pickPastime(): Pastime {
    const asked = this.nextPastime
    this.nextPastime = null
    if (asked) return asked
    const options = (Object.keys(PASTIMES) as Pastime[]).filter(k => k !== this.lastPastime && (k !== 'admire' || this.homeItems.length))
    const total = options.reduce((sum, k) => sum + PASTIMES[k].weight, 0)
    let r = this.rand() * total
    for (const k of options) if ((r -= PASTIMES[k].weight) < 0) return k
    return options[0] ?? 'tend'
  }

  /** Out one side of the room and in from the other side of the next, until he is where the pastime is. */
  private stepTrip(dt: number) {
    const t = this.trip!
    if (this.room === t.to) {
      this.trip = null // in from the edge: the pastime's own walk takes him to its spot
      return
    }
    this.facing = t.dir
    this.moving = true
    this.x += t.dir * this.pace.walk * HOME_PACE * dt
    const isOut = t.dir > 0 ? this.x >= this.columns + 1 : this.x <= -CLAUDE_WIDTH - 1
    if (!isOut) return
    this.room = ROOMS[ROOMS.indexOf(this.room) + t.dir]!
    this.x = t.dir > 0 ? -CLAUDE_WIDTH : this.columns
  }

  /** Where he stands for a pastime in its room, or null when the room has no space for it. */
  private pastimeSpot(p: { kind: Pastime; flower: number }): number | null {
    const den = this.denLayout()
    switch (p.kind) {
      case 'admire': return clamp(this.x, 0, this.maxX())
      case 'tend': {
        const col = this.flowerCol(p.flower)
        return col === null ? null : clamp(col - CLAUDE_WIDTH + 1, 0, this.maxX())
      }
      case 'movie': return den.tv === null ? null : den.couch + 3
      case 'rest': return den.bed === null ? null : den.bed + BED_HEAD_X
    }
  }

  /** The den's furniture by column, left to right, each null where it would not fit before the door. */
  private denLayout(): { bed: number | null; couch: number; tv: number | null } {
    const room = this.doorCol() - 2
    const bed = 2
    const couch = bed + BED.rows[0]!.length + 4
    const tv = couch + COUCH_BACK.rows[0]!.length + 5
    return { bed: bed + BED.rows[0]!.length <= room ? bed : null, couch, tv: tv + TV.rows[0]!.length <= room ? tv : null }
  }

  private flowerCol(i: number): number | null {
    const start = Math.max(3, Math.round(this.doorCol() * 0.2))
    const col = start + i * FLOWER_STEP
    return col + FLOWER_STAGES[0]![0]!.length <= this.doorCol() - 2 ? col : null
  }

  /** At the keepsakes: strolls from one to another, the label up as he stands by it. */
  private admire(dt: number) {
    if (this.wanderTo !== null) {
      if (this.walk(this.wanderTo, dt * HOME_PACE)) this.wanderTo = null
      return
    }
    if (this.now < this.wanderAt) return
    this.wanderAt = this.now + 3000 + this.rand() * 4000
    const spots = this.homeSpots()
    if (!spots.length) return
    const s = spots[Math.floor(this.rand() * spots.length)]!
    this.wanderTo = clamp(s.col + 3 - Math.floor(CLAUDE_WIDTH / 2) + (this.rand() < 0.5 ? -9 : 9), 0, this.maxX())
  }

  /** In the garden: kneels by a flower with the can, a few drops falling, then moves on to the next. */
  private tend(p: { next: number; flower: number }, dt: number) {
    const spot = this.flowerCol(p.flower)
    const at = spot === null ? null : clamp(spot - CLAUDE_WIDTH + 1, 0, this.maxX())
    if (at !== null && Math.abs(this.x - at) > 0.5) {
      this.walk(at, dt * HOME_PACE)
      p.next = this.now
      return
    }
    this.facing = 1
    this.bob = Math.floor(this.now / 700) % 2
    if (this.rand() < 9 * dt) {
      const spout = Math.round(this.x) + CLAUDE_WIDTH + 3
      const top = this.spriteTop ?? this.rows * 2 - 9
      this.dirt.push({ x: spout, y: top + 3, vx: 1 + this.rand(), vy: 1, until: this.now + 500, color: P.sky })
    }
    if (this.now - p.next >= WATER_SECS * 1000) {
      // this one is watered: it grows a stage; on to another
      this.flowerTended(p.flower)
      let next = Math.floor(this.rand() * FLOWER_COUNT)
      if (next === p.flower) next = (next + 1) % FLOWER_COUNT
      p.flower = this.flowerCol(next) === null ? 0 : next
      p.next = this.now
    }
  }

  private flowerTended(i: number) {
    this.ensureFlowers()
    const f = this.flowers[i]
    if (!f) return
    if (f.stage < FLOWER_STAGES.length - 1) f.stage++
    else if (this.rand() < 0.25) {
      // a bloom that has had its day is picked, and a new seed goes in
      f.stage = 0
      f.color = Math.floor(this.rand() * FLOWER_COLORS.length)
    }
  }

  private ensureFlowers() {
    while (this.flowers.length < FLOWER_COUNT) {
      this.flowers.push({ stage: Math.floor(this.rand() * FLOWER_STAGES.length), color: Math.floor(this.rand() * FLOWER_COLORS.length) })
    }
  }

  /** Walks beside a prop and turns to it; true once there. */
  private approach(prop: Prop, dt: number): boolean {
    const at = this.col(prop.x, prop.id)
    const side = this.x + CLAUDE_WIDTH / 2 < at ? -1 : 1
    const spot = side < 0 ? at - CLAUDE_WIDTH - 1 : at + propWidth(prop) + 1
    if (!this.walk(spot, dt)) return false
    this.facing = side < 0 ? 1 : -1
    return true
  }

  private target(col: number) {
    return clamp(col, 0, this.maxX())
  }

  /** Moves toward `target`; true once there. */
  private walk(target: number, dt: number, speed = this.pace.walk): boolean {
    target = this.target(target)
    const d = target - this.x
    if (Math.abs(d) < 0.5) {
      this.x = target
      return true
    }
    this.facing = d > 0 ? 1 : -1
    this.moving = true
    this.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt)
    return false
  }

  /** Starts an effect near the head (or at a given pixel). */
  private give(kind: Effect['kind'], x?: number, y?: number) {
    // the sprite's real top edge as last drawn: a slumped or crouched figure is a pixel lower
    const head = this.spriteTop ?? this.rows * 2 - 2 - CLAUDE_HEIGHT - Math.round(this.lift)
    const mid = this.x + CLAUDE_WIDTH / 2
    const now = this.now
    switch (kind) {
      case 'sparkle': {
        const color = [P.yellow, P.white, P.coral, P.sky][Math.floor(this.rand() * 4)]!
        this.effects.push({
          kind, color, start: now, until: now + 450,
          x: x ?? Math.round(this.x + this.rand() * (CLAUDE_WIDTH + 8) - 4),
          y: y ?? 1 + Math.floor(this.rand() * Math.max(1, this.rows * 2 - 8)),
        })
        return
      }
      case 'heart':
        // beside the head, left or right, so a balloon above it never hides them
        this.effects.push({ kind, x: Math.round(mid + (this.rand() < 0.5 ? -10 : 6)), y: head - 2, start: now, until: now + 1400 })
        return
      case 'tear': {
        // from under one of the drooping eyes (rows 2-3, columns 3 and 7: the same either way he faces)
        const eye = this.x + (this.rand() < 0.5 ? 3 : 7)
        this.effects.push({ kind, x: Math.round(eye), y: head + 4, start: now, until: now + 700 })
        return
      }
      case 'steam': {
        const side = this.rand() < 0.5 ? this.x + 1 : this.x + CLAUDE_WIDTH - 3
        this.effects.push({ kind, x: Math.round(side), y: head - 1, start: now, until: now + 600 })
        return
      }
      case 'sweat': {
        const side = this.facing > 0 ? this.x + CLAUDE_WIDTH - 2 : this.x + 1
        this.effects.push({ kind, x: Math.round(side), y: head, start: now, until: now + 900 })
        return
      }
      case 'zzz':
        this.effects.push({ kind, x: Math.round(mid + 3), y: head - 2, start: now, until: now + 2200 })
        return
      case 'dust': {
        const heel = this.facing > 0 ? this.x - 1 : this.x + CLAUDE_WIDTH - 1
        this.effects.push({ kind, x: Math.round(x ?? heel), y: y ?? this.rows * 2 - 3, start: now, until: now + 350 })
        return
      }
      case 'poof':
        this.effects.push({ kind, x: x ?? Math.round(mid), y: y ?? head, start: now, until: now + 600 })
        return
      case 'balloon': {
        const hand = this.facing > 0 ? this.x + CLAUDE_WIDTH - 1 : this.x - 2
        this.effects.push({ kind, x: Math.round(x ?? hand), y: y ?? head - 2, start: now, until: now + 4500 })
        return
      }
    }
  }

  /** A subagent was started: a small Claude walks in from the edge with its task as a label. */
  helperStart(id: string, label: string, isBackground = false) {
    if (this.helpers.length >= MAX_HELPERS || this.helpers.some(h => h.id === id)) return
    const fromRight = this.x < this.columns / 2
    this.helpers.push({
      id, label: cellText(label), isBackground,
      x: fromRight ? this.columns : -MINI_WIDTH,
      facing: fromRight ? -1 : 1,
      target: this.helperSpot(),
      state: 'arriving', activity: null, activityUntil: 0,
      born: this.now, lastActive: this.now, reportAt: 0, moving: false,
    })
  }

  /** A tool call inside a subagent: its small Claude acts it out for a moment. */
  helperActivity(agentId: string, tool: string) {
    let h = this.helpers.find(h => h.agentId === agentId) ?? this.helpers.find(h => !h.agentId && h.state !== 'leaving')
    if (!h) {
      // a subagent we never saw start (it began before a reload, or in the background): it walks in now
      this.helperStart(`agent:${agentId}`, '', true)
      h = this.helpers.find(h => h.id === `agent:${agentId}`)
      if (!h) return
    }
    h.agentId = agentId
    h.activity = /^(Read|WebFetch|NotebookRead)$/.test(tool) ? 'read' : /^(Grep|Glob|WebSearch)$/.test(tool) ? 'dig' : 'type'
    h.activityUntil = this.now + 1600
    h.lastActive = this.now
  }

  /** A subagent finished: its small Claude walks over to Claude to report, then vanishes. */
  /** A subagent that went on in the background: its small Claude stays until it falls quiet. */
  helperBackground(id: string) {
    const h = this.helpers.find(h => h.id === id)
    if (h) h.isBackground = true
  }

  /** A subagent finished (its stop event): the small Claude acting for it reports back. */
  helperDoneByAgent(agentId: string) {
    const h = this.helpers.find(h => h.agentId === agentId)
    if (h && h.state !== 'reporting') h.state = 'leaving'
  }

  helperDone(id: string) {
    const h = this.helpers.find(h => h.id === id)
    if (h && h.state !== 'reporting') h.state = 'leaving'
  }

  /** How many small Claudes are on stage (for tests and the band). */
  get helperCount(): number {
    return this.helpers.length
  }

  /** A free-ish spot for a helper: away from Claude and from the other helpers. */
  private helperSpot(): number {
    const span = Math.max(1, this.columns - MINI_WIDTH)
    for (let k = 0; k < 12; k++) {
      const x = Math.floor(this.rand() * span)
      const clearOfClaude = x + MINI_WIDTH * 3 + 3 < this.x || x > this.x + CLAUDE_WIDTH + MINI_WIDTH * 2 + 3
      const clearOfOthers = this.helpers.every(h => Math.abs((h.target ?? h.x) - x) > MINI_WIDTH + 2)
      if (clearOfClaude && clearOfOthers) return x
    }
    return Math.floor(this.rand() * span)
  }

  private stepHelpers(dt: number) {
    const now = this.now
    const toward = (h: Helper, target: number, speed: number) => {
      const d = target - h.x
      h.moving = Math.abs(d) >= 0.5
      if (!h.moving) return true
      h.facing = d > 0 ? 1 : -1
      h.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt)
      return false
    }
    for (const h of this.helpers) {
      h.moving = false
      if (h.state === 'arriving') {
        if (toward(h, h.target ?? h.x, this.pace.walk * 0.8)) h.state = 'working'
      } else if (h.state === 'working') {
        if (h.target !== null && toward(h, h.target, this.pace.walk * 0.5)) h.target = null
        // keeps out of Claude's way (and of anyone reporting to him); between tool calls it potters about a little
        const nearClaude = (x: number) => x + MINI_WIDTH + 3 > this.x - MINI_WIDTH * 2 && x < this.x + CLAUDE_WIDTH + MINI_WIDTH * 2 + 3
        if (h.target === null && nearClaude(h.x)) h.target = this.helperSpot()
        if (h.target === null && now > h.activityUntil && this.rand() < 0.25 * dt) {
          const next = clamp(h.x + (this.rand() * 12 - 6), 0, this.columns - MINI_WIDTH)
          if (!nearClaude(next)) h.target = next
        }
        if (h.activity === 'dig' && now < h.activityUntil && this.rand() < 4 * dt) {
          const front = h.facing > 0 ? h.x + MINI_WIDTH : h.x - 1
          this.dirt.push({ x: front, y: this.rows * 2 - 3, vx: -h.facing * 8, vy: -14, until: now + 500, color: LOOKS[this.scene.setting].dirt })
        }
        // a background helper with nothing more to do wanders off after a quiet spell
        if (h.isBackground && now - h.lastActive > 45_000 && now - h.born > 20_000) h.state = 'leaving'
      } else if (h.state === 'leaving') {
        // to Claude's side, to hand over what it found, queueing behind helpers already there
        const isLeft = h.x < this.x
        const ahead = this.helpers.filter(o => o !== h && (o.state === 'reporting' || o.state === 'leaving') && o.x < this.x === isLeft && Math.abs(o.x - this.x) < Math.abs(h.x - this.x)).length
        const step = (MINI_WIDTH + 1) * ahead
        const side = isLeft ? this.x - MINI_WIDTH - 1 - step : this.x + CLAUDE_WIDTH + 1 + step
        if (toward(h, side, this.pace.walk)) {
          h.state = 'reporting'
          h.reportAt = now
          h.facing = h.x < this.x ? 1 : -1
        }
      } else if (now - h.reportAt > 700) {
        this.give('poof', Math.round(h.x + MINI_WIDTH / 2) - 1, this.rows * 2 - 6)
        for (let k = 0; k < 2; k++) this.give('sparkle')
        h.state = 'leaving'
        h.label = ''
        h.reportAt = -1 // marks it for removal below
      }
    }
    this.helpers = this.helpers.filter(h => h.reportAt !== -1)
  }

  private drawHelpers(c: Canvas) {
    const now = this.now
    const ground = this.rows * 2 - 2
    const labels: [number, number, number][] = [] // row, left, right of labels already drawn
    for (const [index, h] of this.helpers.entries()) {
      const isWorking = h.state === 'working' && now < h.activityUntil
      const bob = isWorking && h.activity !== 'read' ? Math.floor(now / 180) % 2 : 0
      const hop = h.state === 'reporting' ? Math.round(Math.sin((Math.PI * (now - h.reportAt)) / 700) * 2) : 0
      const art = miniClaude({ walk: h.moving ? Math.floor(now / 140) : 0, blink: now % 3900 < 130, left: h.facing < 0 })
      const left = Math.round(h.x)
      const top = ground - MINI_HEIGHT + bob - hop
      c.sprite(left, top, art, TINTS.normal)
      if (isWorking && h.activity === 'read') {
        c.sprite(h.facing > 0 ? left + 4 : left, top + 2, BITS.miniBook.rows, BITS.miniBook.palette)
      }
      // its task, for the first few seconds on stage
      if (h.label && now - h.born < 4000) {
        // alternate rows so two arriving helpers' labels do not run into each other; skip one that still would
        const chars = [...h.label]
        const text = chars.length > 16 ? chars.slice(0, 15).join('') + '…' : h.label
        const row = Math.max(0, Math.floor(top / 2) - 1 - (index % 2))
        const l = clamp(left + 3 - Math.floor(text.length / 2), 0, Math.max(0, this.columns - text.length))
        const r = l + text.length
        if (labels.every(([lr, ll, rr]) => lr !== row || r + 1 <= ll || rr + 1 <= l)) {
          c.text(l, row, text, P.mist)
          labels.push([row, l, r])
        }
      }
    }
  }

  /** Sets down whatever Claude carries, just in front of him. */
  private putDown() {
    const prop = this.scene.props.find(p => p.id === this.carrying)
    if (prop) {
      const w = propWidth(prop)
      const want = this.facing > 0 ? this.x + CLAUDE_WIDTH + 1 : this.x - w - 1
      const near = clamp(Math.round(want), 0, this.columns - w)
      const at = this.freeCol(prop, near) ?? this.leastCrowdedCol(prop, near)
      this.placed.set(prop.id, at)
      this.give('dust', this.facing > 0 ? at : at + w - 2, this.rows * 2 - 3)
    }
    this.carrying = null
  }

  private throwDirt() {
    // off the blade in front, in a high arc back over his head (drawn behind him)
    const blade = this.facing > 0 ? this.x + CLAUDE_WIDTH + 1 : this.x - 3
    const look = LOOKS[this.scene.setting]
    this.dirt.push({
      x: blade,
      y: this.rows * 2 - 4,
      vx: -this.facing * (14 + this.rand() * 10),
      vy: -(26 + this.rand() * 6), // peaks well above his head, so no clod lands on it
      until: this.now + 650,
      color: this.rand() < 0.6 ? look.dirt : look.grassHi,
    })
  }

  private prop(id: string): Prop | undefined {
    return this.removed.has(id) || this.carrying === id ? undefined : this.scene.props.find(p => p.id === id)
  }

  /** The columns a prop takes up at `col`: its sprite or board, and any label above it. */
  private span(prop: Prop, col: number): [number, number] {
    const width = propWidth(prop)
    if (prop.kind === 'sign' || !prop.label) return [col, col + width]
    const label = [...prop.label].length
    const labelLeft = col + Math.floor(width / 2) - Math.floor(label / 2)
    return [Math.min(col, labelLeft), Math.max(col + width, labelLeft + label)]
  }

  /**
   * The nearest column to `want` where `prop` overlaps no other standing prop
   * (two columns apart), or null when the band is too full for that.
   */
  private freeCol(prop: Prop, want: number, others = this.standing(prop.id)): number | null {
    const GAP = 2
    const [l0, r0] = this.span(prop, 0)
    const fits = (col: number) => {
      const [l, r] = [l0 + col, r0 + col]
      if (l < 0 || r > this.columns) return false
      return others.every(([ol, or]) => r + GAP <= ol || or + GAP <= l)
    }
    for (let d = 0; d <= this.columns; d++) {
      if (fits(want + d)) return want + d
      if (fits(want - d)) return want - d
    }
    return null
  }

  /** Where `prop` overlaps the least, nearest `want` among equals: for when nothing is free. */
  private leastCrowdedCol(prop: Prop, want: number, others = this.standing(prop.id)): number {
    const [l0, r0] = this.span(prop, 0)
    let best = clamp(want, 0, Math.max(0, this.columns - (r0 - l0)))
    let bestCost = Infinity
    for (let col = -l0; col + r0 <= this.columns; col++) {
      const cost = others.reduce((sum, [ol, or]) => sum + Math.max(0, Math.min(r0 + col, or) - Math.max(l0 + col, ol)), 0)
      if (cost < bestCost || (cost === bestCost && Math.abs(col - want) < Math.abs(best - want))) {
        best = col
        bestCost = cost
      }
    }
    return best
  }

  /** The spans of every prop on the ground, except `exceptId`. */
  private standing(exceptId?: string): [number, number][] {
    return this.scene.props
      .filter(p => p.id !== exceptId && !this.removed.has(p.id) && this.carrying !== p.id)
      .map(p => this.span(p, this.col(p.x, p.id)))
  }

  /** Lays a new world's props out left to right, each at the free spot nearest where it was asked for. */
  private arrange() {
    const laid: [number, number][] = []
    const byPlace = [...this.scene.props].sort((a, b) => a.x - b.x)
    for (const prop of byPlace) {
      const want = this.col(prop.x)
      const col = this.freeCol(prop, want, laid) ?? this.leastCrowdedCol(prop, want, laid)
      this.placed.set(prop.id, col)
      laid.push(this.span(prop, col))
    }
  }

  private maxX() {
    return Math.max(0, this.columns - CLAUDE_WIDTH)
  }

  /** A 0..100 position as a column; a prop that was carried keeps where it was put. */
  private col(pct: number, id?: string) {
    const placed = id === undefined ? undefined : this.placed.get(id)
    return placed ?? Math.round((pct / 100) * Math.max(0, this.columns - CLAUDE_WIDTH))
  }

  /** The face and arms for this moment: the beat's own, else the mood's. */
  private pose(): { face: Face; back: Arm; front: Arm; tint: Tint } {
    const now = this.now
    const mood = MOOD_LOOK[this.mood()]
    let face: Face = this.looking ? 'right' : mood.face
    let back: Arm = 'down'
    let front: Arm = 'down'
    const flip = (ms: number) => Math.floor(now / ms) % 2 === 0
    switch (this.run?.phase === 1 || this.run?.phase === 0 ? this.run.beat.do : undefined) {
      case 'read': face = 'down'; front = 'mid'; break
      case 'ponder': front = 'mid'; break
      case 'type':
        if (this.run?.phase === 1) {
          face = 'down'
          front = flip(140) ? 'mid' : 'down'
          back = flip(140) ? 'down' : 'mid'
        }
        break
      case 'wave': face = 'happy'; front = flip(220) ? 'up' : 'mid'; break
      case 'shrug': face = 'squint'; back = 'up'; front = 'up'; break
      case 'dance': face = 'happy'; back = flip(250) ? 'up' : 'mid'; front = flip(250) ? 'mid' : 'up'; break
      case 'celebrate': face = 'happy'; back = 'up'; front = 'up'; break
      case 'run': back = 'mid'; front = 'mid'; break
      case 'dig': front = 'mid'; break
      case 'plant_sign': if (this.run?.phase === 1) front = this.bob ? 'mid' : 'up'; break
      case 'pull_sign': if (this.run?.phase) { front = 'mid'; back = 'mid' } break
    }
    if (this.carrying) {
      back = 'up'
      front = 'up'
    }
    if (this.leaving?.isSprint && this.leaving.phase === 'walk') {
      // sprinting for the door, arms out like a run
      back = 'mid'
      front = 'mid'
    }
    if (this.isWatching) face = this.react ? 'happy' : 'right'
    if (this.isTending) {
      face = 'down'
      front = 'mid'
    }
    if (this.calling) {
      // turned to the person, one arm waving
      face = 'ahead'
      front = flip(300) ? 'up' : 'mid'
    }
    // blinking, unless the eyes are already doing something
    if ((face === 'ahead' || face === 'right') && now % 4200 < 140) face = 'blink'
    return { face, back, front, tint: mood.tint }
  }

  /** Draws the frame for a band of `columns` by `rows` and encodes it. */
  frame(columns: number, rows: number): string {
    if (columns !== this.columns || rows !== this.rows) {
      this.columns = columns
      this.rows = rows
      this.x = clamp(this.x, 0, this.maxX())
    }
    const c = new Canvas(columns, rows)
    const look = this.isHome || this.isAway ? ROOM_LOOK[this.room] : LOOKS[this.scene.setting]
    const H = rows * 2
    const now = this.now

    // back to front: sky, far layer, motes, ground, props, dirt, figure, effects, words
    drawSky(c, look, now, this.ambience)
    drawFar(c, look, now)
    drawMotes(c, look, now)
    drawGround(c, look)
    if (this.progress && this.progress.total > 0) drawProgress(c, this.progress)
    if (this.isHome || this.isAway) this.drawHome(c, H - 2)
    if (this.portal) {
      const door = this.portal.phase === 'open' || this.portal.phase === 'in' ? DOOR.open : DOOR.closed
      c.sprite(this.portal.col, H - 2 - door.length, door, DOOR.palette)
    }
    for (const col of this.pennants) c.sprite(col, H - 2 - PENNANT.rows.length, PENNANT.rows, PENNANT.palette)

    // the bubble is laid out before anything is drawn, so a sign board it would cut into is left out
    const bubbleHead = Math.floor((H - 2 - CLAUDE_HEIGHT - Math.round(this.lift)) / 2)
    const bubble = this.calling
      ? this.layoutBubble(rows, this.calling === 'question' ? 'A question for you ▸' : 'Needs your OK ▸', 'call', bubbleHead)
      : this.bubble
      ? this.layoutBubble(rows, this.bubble.text, this.bubble.kind, bubbleHead)
      // the director is asked ahead now, so its dots show only once the stage has run dry
      : (this.pondering && this.idleSince !== null) || this.run?.beat.do === 'ponder'
        ? this.layoutBubble(rows, '.'.repeat(1 + (Math.floor(now / 400) % 3)).padEnd(3), 'think', bubbleHead)
        : null
    this.bubbleArea = bubble ? bubbleRect(bubble) : null

    for (const prop of this.scene.props) {
      if (this.removed.has(prop.id) || this.carrying === prop.id) continue
      this.drawProp(c, prop, this.col(prop.x, prop.id), H - 2)
    }

    for (const p of this.dirt) {
      c.set(p.x, p.y, p.color)
      c.set(p.x + 1, p.y, p.color)
    }

    this.drawHelpers(c)

    const pose = this.pose()
    const beat = this.run?.beat.do
    const isStill = !this.moving && this.lift < 0.5
    const isSlumped = this.mood() === 'sad'
    const breathMs = this.mood() === 'sleepy' ? 1400 : 700
    // angry and worried figures shake; everyone else stands still
    const shake = (this.mood() === 'angry' || this.mood() === 'worried') && Math.floor(now / 90) % 2 === 0 ? 1 : 0
    const art = claude({
      ...pose,
      walk: this.moving ? Math.floor(now / (beat === 'run' || this.leaving?.isSprint ? 70 : 120)) : 0,
      airborne: this.lift > 1,
      crouch: isSlumped || this.isWatching || this.bob > 0 || (isStill && Math.floor(now / breathMs) % 2 === 1),
      left: this.facing < 0,
    })
    const left = Math.round(this.x) + shake
    // the sprite stands on the ground; a crouch is shorter, so the head drops one pixel
    const top = H - 2 - art.length - Math.round(this.lift)
    this.spriteTop = top
    if (this.hidden || this.isResting) {
      if (this.isResting) {
        // in bed: lying down, tucked in under the blanket
        const lying = claudeLying(this.calling ? 'open' : 'shut')
        const bed = this.denLayout().bed ?? 2
        this.spriteTop = H - 2 - 2 - lying.length
        c.sprite(bed + BED_HEAD_X, this.spriteTop, lying, TINTS.normal)
        c.sprite(bed + BED_HEAD_X + 1, this.spriteTop - 1, SLEEP_CAP.rows, SLEEP_CAP.palette)
        c.sprite(bed, H - 2 - BED_OVER.rows.length, BED_OVER.rows, BED_OVER.palette)
      }
      for (const e of this.effects) drawEffect(c, e, now)
      if (bubble) this.drawBubble(c, bubble)
      return c.encode()
    }
    const seated = this.isWatching ? SIT_LIFT : 0
    c.sprite(left, top - seated, art, TINTS[pose.tint])
    if (this.isWatching) {
      const couch = this.denLayout().couch
      c.sprite(couch, H - 2 - COUCH_FRONT.rows.length, COUCH_FRONT.rows, COUCH_FRONT.palette)
    }
    if (this.isTending) {
      const can = WATERING_CAN
      c.sprite(left + CLAUDE_WIDTH - 1, top + 2 + this.bob, can.rows, can.palette)
    }

    // the hat: the turn's, or a nightcap while he dozes; tucked away while something rides overhead
    const hatName = this.isDozing ? 'nightcap' : this.scene.hat ?? 'none'
    const hat = hatName === 'none' || this.carrying ? null : HATS_ART[hatName]
    const hatRise = hat ? hat.rows.length - hat.sit : 0
    if (hat) c.sprite(left, top - hatRise, hat.rows, hat.palette, this.facing < 0)

    // what the figure holds
    if (beat === 'dig') {
      const tool = this.bob ? BITS.shovel : BITS.shovelUp
      const sx = this.facing > 0 ? left + CLAUDE_WIDTH - 1 : left - 3
      c.sprite(sx, top + 1 + this.bob, tool.rows, tool.palette, this.facing < 0)
    }
    if (beat === 'read' && this.run) {
      const book = Math.floor(now / 900) % 3 === 2 ? BITS.bookFlip : BITS.book
      // held low and centred, below the downcast eyes, so it never covers one
      c.sprite(left + 3, top + 4, book.rows, book.palette, this.facing < 0)
    }
    if (this.carrying) {
      const prop = this.scene.props.find(p => p.id === this.carrying)
      if (prop) this.drawProp(c, prop, Math.round(left + CLAUDE_WIDTH / 2 - propWidth(prop) / 2), top)
    }

    if (this.balloon && this.balloon.mood !== 'neutral') {
      // pops up from the head: the first 120 ms it sits two pixels lower
      const pop = now - (this.balloon.until - 2500) < 120 ? 2 : 0
      // above the head (and its hat); beside the head when a tall hat leaves no room above
      let bx = clamp(Math.round(this.x + CLAUDE_WIDTH / 2 - 3), 0, columns - 9)
      let by = top - 9 - hatRise + pop
      if (by < 0) {
        bx = this.x + CLAUDE_WIDTH + 10 <= columns ? Math.round(this.x + CLAUDE_WIDTH + 1) : Math.max(0, Math.round(this.x - 10))
        by = Math.max(0, top - 6 + pop)
      }
      c.sprite(bx, by, BALLOON.rows, BALLOON.palette)
      const icon = MOOD_ICONS[this.balloon.mood]
      c.sprite(bx + 2, by + 1, icon.rows, icon.palette)
    }


    for (const e of this.effects) drawEffect(c, e, now)

    const headRow = Math.floor((H - 2 - CLAUDE_HEIGHT - Math.round(this.lift)) / 2)
    const markRow = Math.max(0, headRow - 1 - Math.ceil(hatRise / 2))
    if (this.react) c.text(Math.round(this.x + CLAUDE_WIDTH / 2), markRow, this.react.glyph, P.yellow)
    // a tool cue sits just off the head, out of the way of a reaction or a mood balloon
    else if (this.cueMark && !this.balloon) c.text(Math.round(this.x + CLAUDE_WIDTH / 2) + 1, markRow, this.cueMark.glyph, this.cueMark.color)

    if (this.isHome) {
      for (const l of this.homeLabels) {
        // clear sky behind each title, so a drifting mote never shows through as a block
        for (let k = 0; k < [...l.text].length; k++) {
          c.set(l.col + k, l.row * 2, DEFAULT)
          c.set(l.col + k, l.row * 2 + 1, DEFAULT)
        }
        c.text(l.col, l.row, l.text, l.color)
      }
    }

    const caption = this.run?.beat.caption
    if (caption) c.text(0, 0, ` ${caption} `.slice(0, columns), P.white, P.slate)

    if (bubble) this.drawBubble(c, bubble)

    return c.encode()
  }

  /** Draws a prop standing on pixel row `ground` (its bottom row just above it). */
  private drawProp(c: Canvas, prop: Prop, col: number, ground: number) {
    if (prop.kind === 'sign') {
      const label = prop.label ?? '?'
      const width = [...label].length + 4
      const motion = this.signMotion.get(prop.id)
      const m = motion ? Math.min(1, (this.now - motion.start) / motion.ms) : 1
      // shaken loose: a one-column wobble; pulled out: the whole sign lifts two rows
      if (motion?.kind === 'shake') col += Math.floor(this.now / 90) % 2 ? 1 : -1
      const rise = motion?.kind === 'rise' ? Math.round(m * 2) : 0
      const boxTop = Math.max(0, Math.floor(ground / 2) - 5) - rise
      const post = col + Math.floor(width / 2) - 1
      const postTop = (boxTop + 3) * 2
      const postBottom = ground - rise * 2
      // hammered in: the post grows out of the ground blow by blow, then the board types itself in
      const grow = motion?.kind === 'grow' ? m : 1
      const shown = Math.ceil(grow * (postBottom - postTop))
      for (let y = postBottom - shown; y < postBottom; y++) {
        c.set(post, y, P.wood)
        c.set(post + 1, y, P.bark)
      }
      const board = { left: col, top: boxTop, width, height: 3 }
      if (grow >= 0.5 && !(this.bubbleArea && overlap(board, this.bubbleArea))) {
        const typed = [...label].slice(0, Math.ceil(((grow - 0.5) / 0.5) * [...label].length)).join('')
        c.box(col, boxTop, [typed + ' '.repeat([...label].length - [...typed].length)], SIGN.fg, SIGN.bg, SIGN.border)
      }
      return
    }
    const rows = prop.kind === 'flag' && Math.floor(this.now / 400) % 2 === 1 ? FLAG_WAVE : PROPS[prop.kind].rows
    const top = ground - rows.length
    c.sprite(col, top, rows, PROPS[prop.kind].palette)
    if (prop.kind === 'computer') {
      const isTyping = this.run?.beat.do === 'type' && this.run.phase === 1
      if (Math.floor(this.now / (isTyping ? 120 : 500)) % 2 === 0) c.set(col + (isTyping ? 2 + Math.floor(this.now / 240) % 4 : 5), top + 2, P.leaf)
    }
    if (prop.label && ground === c.height - 2) {
      const row = Math.max(0, Math.floor(top / 2) - 1)
      c.text(col + Math.floor(propWidth(prop) / 2) - Math.floor([...prop.label].length / 2), row, prop.label, P.mist)
    }
  }

  /** The hub: his keepsakes left of the door, the nearest one's label up, the door open as he passes. */
  private drawHome(c: Canvas, ground: number) {
    this.homeLabels = []
    if (this.room === 'garden') this.drawGarden(c, ground)
    if (this.room === 'den') this.drawDen(c, ground)
    if (this.room !== 'hall') return this.drawDoor(c, ground)
    const near = this.x + CLAUDE_WIDTH / 2
    // every keepsake keeps its title up, dim; the one he stands by (or a new one) brightly
    const titles: { text: string; center: number; row: number; color: number; rank: number; order: number }[] = []
    for (const { item, col } of this.homeSpots()) {
      const art = HUB_ART[item.kind]
      const top = ground - art.rows.length
      c.sprite(col, top, art.rows, art.palette)
      const center = col + Math.floor(art.rows[0]!.length / 2)
      const isNew = this.newItem?.item === item
      const isNear = !this.hidden && Math.abs(near - center) <= 10 && !this.moving
      titles.push({
        text: item.label, center, row: Math.max(0, Math.floor(top / 2) - 1),
        color: isNew ? P.yellow : isNear ? P.silver : P.steel, rank: isNew ? 0 : isNear ? 1 : 2, order: titles.length,
      })
    }
    // the brightest are placed first; neighbours step up a row rather than run into each other
    const taken: [number, number, number][] = [] // row, left, right
    for (const t of [...titles].sort((a, b) => a.rank - b.rank)) {
      const width = [...t.text].length
      const left = clamp(t.center - Math.floor(width / 2), 0, Math.max(0, this.columns - width))
      const rows = t.order % 2 ? [t.row - 1, t.row] : [t.row, t.row - 1]
      const row = rows.find(r => r >= 0 && taken.every(([tr, l, r2]) => tr !== r || left + width + 1 <= l || r2 + 1 <= left))
      if (row === undefined) continue
      taken.push([row, left, left + width])
      this.homeLabels.push({ col: left, row, text: t.text, color: t.color })
    }
    this.drawDoor(c, ground)
  }

  private drawDoor(c: Canvas, ground: number) {
    const isOpen = this.now < this.doorOpenUntil || this.leaving?.phase === 'open' || this.leaving?.phase === 'in'
    const door = isOpen ? DOOR.open : DOOR.closed
    c.sprite(this.doorCol(), ground - door.length, door, DOOR.palette)
  }

  /** The flower bed: a strip of soil, each flower at its stage. */
  private drawGarden(c: Canvas, ground: number) {
    this.ensureFlowers()
    const first = this.flowerCol(0)
    if (first === null) return
    let last = first
    this.flowers.forEach((f, i) => {
      const col = this.flowerCol(i)
      if (col === null) return
      last = col + FLOWER_STAGES[0]![0]!.length
      const rows = FLOWER_STAGES[f.stage]!
      const [petal, shade] = FLOWER_COLORS[f.color]!
      c.sprite(col, ground - rows.length, rows, flowerPalette(petal, shade))
    })
    for (let x = first - 1; x <= last; x++) c.set(x, ground, P.bark)
  }

  /** The den: the bed, the couch's back and the TV, its screen playing while he watches. */
  private drawDen(c: Canvas, ground: number) {
    const { bed, couch, tv } = this.denLayout()
    if (bed !== null) c.sprite(bed, ground - BED.rows.length, BED.rows, BED.palette)
    c.sprite(couch, ground - COUCH_BACK.rows.length, COUCH_BACK.rows, COUCH_BACK.palette)
    if (tv === null) return
    const top = ground - TV.rows.length
    c.sprite(tv, top, TV.rows, TV.palette)
    if (!this.isWatching) return
    // the film: a sky and a ground that change with each cut, a figure crossing
    const cut = Math.floor(this.now / 2600)
    const skies = [P.sky, P.navy, P.plum, P.amber, P.slate]
    const grounds = [P.leaf, P.moss, P.sand, P.steel, P.wood]
    const s = TV_SCREEN
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        c.set(tv + s.x + x, top + s.y + y, y < Math.ceil(s.h / 2) ? skies[cut % skies.length]! : grounds[(cut * 3) % grounds.length]!)
      }
    }
    const walker = Math.floor((this.now % 2600) / (2600 / s.w))
    c.set(tv + s.x + walker, top + s.y + Math.ceil(s.h / 2) - 1, P.white)
  }

  /**
   * Where the bubble goes: beside Claude, on whichever side covers the least signage,
   * so a remark and a sign board never cut into each other.
   */
  private layoutBubble(rows: number, text: string, kind: BubbleLayout['kind'], headRow: number): BubbleLayout {
    const maxInner = clamp(this.columns - CLAUDE_WIDTH - 8, 10, 40)
    const maxLines = clamp(rows - 3, 1, 4)
    // the narrowest bubble that holds the whole remark, else the widest, ellipsized
    let inner = Math.min(maxInner, 26)
    let lines = wrap(text, inner)
    while (lines.length > maxLines && inner < maxInner) {
      inner = Math.min(maxInner, inner + 4)
      lines = wrap(text, inner)
    }
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines)
      const last = lines[maxLines - 1]!
      lines[maxLines - 1] = (last.length >= inner ? last.slice(0, inner - 1) : last) + '…'
    }
    const width = Math.max(...lines.map(l => [...l].length)) + 4
    const height = lines.length + 2
    const top = clamp(headRow - height + 3, 0, Math.max(0, rows - height))
    const link = clamp(headRow + 1, top + 1, top + height - 2)
    const x = Math.round(this.x)

    const sides: BubbleLayout[] = []
    if (x + CLAUDE_WIDTH + 2 + width <= this.columns) sides.push({ kind, lines, width, height, top, link, side: 'right', left: x + CLAUDE_WIDTH + 2 })
    if (x - 2 - width >= 0) sides.push({ kind, lines, width, height, top, link, side: 'left', left: x - 2 - width })
    if (!sides.length) sides.push({ kind, lines, width, height, top: 0, link, side: 'above', left: clamp(x - Math.floor(width / 2), 0, Math.max(0, this.columns - width)) })
    const boards = this.signBoards(rows)
    const cost = (b: BubbleLayout) => boards.reduce((sum, r) => sum + overlap(bubbleRect(b), r), 0)
    return sides.reduce((best, b) => (cost(b) < cost(best) ? b : best))
  }

  /** The board of every standing sign, in cells. */
  private signBoards(rows: number): Rect[] {
    return this.scene.props
      .filter(p => p.kind === 'sign' && !this.removed.has(p.id) && this.carrying !== p.id)
      .map(p => ({ left: this.col(p.x, p.id), top: Math.max(0, rows - 6), width: [...(p.label ?? '?')].length + 4, height: 3 }))
  }

  private drawBubble(c: Canvas, b: BubbleLayout) {
    const style = b.kind === 'say' ? BUBBLE : b.kind === 'call' ? CALL : THOUGHT
    c.box(b.left, b.top, b.lines, style.fg, style.bg, style.border)
    if (b.side === 'right') {
      if (b.kind !== 'think') {
        c.text(b.left, b.link, '┤', style.border, style.bg)
        c.text(b.left - 2, b.link, '──', style.border)
      } else c.text(b.left - 1, b.link, 'o', style.border)
    } else if (b.side === 'left') {
      if (b.kind !== 'think') {
        c.text(b.left + b.width - 1, b.link, '├', style.border, style.bg)
        c.text(b.left + b.width, b.link, '──', style.border)
      } else c.text(b.left + b.width, b.link, 'o', style.border)
    }
  }
}

type Rect = { left: number; top: number; width: number; height: number }
type BubbleLayout = Rect & { kind: 'say' | 'think' | 'call'; lines: string[]; link: number; side: 'right' | 'left' | 'above' }

/** The cells a bubble covers, its connector to Claude included. */
function bubbleRect(b: BubbleLayout): Rect {
  return { left: b.left - 2, top: b.top, width: b.width + 4, height: b.height }
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

function drawEffect(c: Canvas, e: Effect, now: number) {
  const t = (now - e.start) / (e.until - e.start)
  switch (e.kind) {
    case 'sparkle':
      // a dot that opens into a plus and closes again
      c.set(e.x, e.y, P.white)
      if (t >= 0.33 && t <= 0.8) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) c.set(e.x + dx, e.y + dy, e.color)
      return
    case 'poof': {
      // eight 2-pixel clumps flying out, white turning grey
      const r = 1.5 + t * 5
      const color = t < 0.5 ? P.white : P.mist
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        const px = e.x + Math.cos(a) * r * 1.6
        const py = e.y + Math.sin(a) * r * 0.8
        c.set(px, py, color)
        c.set(px + 1, py, color)
      }
      return
    }
    case 'heart': {
      // floats up with a slight sway, the last stretch shrunk to a dot
      const x = e.x + Math.round(Math.sin(t * 6))
      const y = e.y - Math.round(t * 6)
      if (t < 0.8) c.sprite(x, y, BITS.heart.rows, BITS.heart.palette)
      else c.set(x + 2, y + 1, P.coral)
      return
    }
    case 'tear':
      // a drop running down from the eye: a light head over a darker tail
      c.set(e.x, e.y + t * 5, P.sky)
      c.set(e.x, e.y + t * 5 - 1, P.navy)
      return
    case 'steam': {
      const y = e.y - t * 4
      const color = t < 0.5 ? P.silver : P.steel
      c.set(e.x, y, color)
      c.set(e.x + 1, y - 1, color)
      return
    }
    case 'sweat': {
      const y = e.y + t * 3
      c.set(e.x, y, P.white)
      c.set(e.x, y + 1, P.sky)
      return
    }
    case 'zzz': {
      // a z drifting up and right, growing into a Z
      const col = e.x + Math.round(t * 4)
      const row = Math.floor((e.y - t * 6) / 2)
      if (row >= 0) c.text(col, row, t < 0.5 ? 'z' : 'Z', t < 0.7 ? P.silver : P.steel)
      return
    }
    case 'dust':
      c.set(e.x, e.y - t * 2, t < 0.5 ? P.silver : P.mist)
      c.set(e.x + 1, e.y - t * 2, P.mist)
      return
    case 'balloon': {
      // let go: it drifts up and off the top, swaying
      const y = Math.round(e.y - t * (e.y + 8))
      const x = e.x + Math.round(Math.sin(t * 9) * 1.5)
      c.sprite(x, y, BALLOON_UP.rows, BALLOON_UP.palette)
      return
    }
  }
}

/** The task trail: a line along the dirt, lit up to how much is done, a flag at its end. */
function drawProgress(c: Canvas, p: { done: number; total: number }) {
  const W = c.columns
  const H = c.height
  const end = W - 5
  const lit = 1 + Math.round(clamp(p.done / p.total, 0, 1) * (end - 1))
  for (let x = 1; x < end; x++) {
    if (x < lit) c.set(x, H - 1, P.amber)
    else if (x % 3 === 0) c.set(x, H - 1, P.tan)
  }
  const flag = p.done >= p.total ? GOAL_FLAG_DONE : GOAL_FLAG
  c.sprite(end, H - 2 - flag.rows.length, flag.rows, flag.palette)
}

function drawSky(c: Canvas, look: Look, now: number, amb: Ambience = { hour: 12, weather: 'clear' }) {
  const W = c.columns
  // out under the sky the local hour shows: a moon and stars at night, a low sun at dawn and dusk
  const isOpenSky = look.sky === 'sun' || look.sky === 'moon'
  const isNight = amb.hour >= 21 || amb.hour < 6
  const isLow = (amb.hour >= 18 && amb.hour < 21) || (amb.hour >= 6 && amb.hour < 8)
  if (look.sky === 'sun' && isNight) look = { ...look, sky: 'moon' }
  if (look.sky === 'sun' && isLow) {
    c.sprite(W - 12, 4, SKY_ART.sun.rows, SKY_ART.sun.palette)
    look = { ...look, sky: 'none' }
  }
  drawSkyArt(c, look, now)
  // clouds pass in front of the sun or moon
  if (isOpenSky) drawWeather(c, amb.weather, now)
}

function drawSkyArt(c: Canvas, look: Look, now: number) {
  const W = c.columns
  if (look.sky === 'stars' || look.sky === 'moon' || look.sky === 'planet') {
    // stars are the one place a lone pixel is right; a few twinkle
    for (let x = 1; x < W; x++) {
      if (hash(x * 3.7) > 0.09) continue
      const y = Math.floor(hash(x * 9.1) * (c.height - 9))
      const isTwinkling = hash(x * 5.3) < 0.3 && Math.sin(now / 300 + x) > 0.4
      c.set(x, y, isTwinkling ? P.white : P.steel)
    }
  }
  if (look.sky === 'none' || look.sky === 'stars') return
  const art = SKY_ART[look.sky]
  c.sprite(W - 12, 1, art.rows, art.palette)
}

/** One or two small clouds drifting over; rain clouds let a few drops fall. */
function drawWeather(c: Canvas, weather: Weather, now: number) {
  if (weather === 'clear') return
  const W = c.columns
  const H = c.height
  const art = weather === 'rain' ? RAIN_CLOUD : CLOUD
  const width = art.rows[0]!.length
  const t = now / 1000
  for (const [k, speed, y] of [[0, 1.2, 1], [1, 0.8, 3]] as const) {
    if (k === 1 && weather === 'cloudy') continue
    const x = Math.round(((k * 37 + t * speed) % (W + width + 6)) - width - 3)
    c.sprite(x, y, art.rows, art.palette)
    if (weather !== 'rain') continue
    for (let d = 0; d < 3; d++) {
      const fall = H - 4 - (y + art.rows.length)
      const dy = (t * 14 + d * 7 + k * 3) % (fall + 4)
      if (dy > fall) continue
      const dx = x + 2 + d * Math.floor((width - 4) / 2)
      c.set(dx, y + art.rows.length + dy, RAIN)
    }
  }
}

function drawFar(c: Canvas, look: Look, now: number) {
  const W = c.columns
  const H = c.height
  const { color, accent } = look.far
  switch (look.far.kind) {
    case 'hills':
    case 'dunes':
    case 'craters': {
      // one slow sine: its steps lengthen and shorten smoothly, no jagged mix of runs
      const period = look.far.kind === 'dunes' ? 11 : look.far.kind === 'hills' ? 7 : 4
      const peak = look.far.kind === 'craters' ? 1.5 : 2.5
      for (let x = 0; x < W; x++) {
        const h = Math.round(peak + 0.5 + peak * Math.sin(x / period + 1))
        const crest = H - 3 - Math.max(1, h)
        for (let y = crest + 1; y <= H - 3; y++) c.set(x, y, color)
        c.set(x, crest, accent)
      }
      return
    }
    case 'pines': {
      for (let x0 = -3; x0 < W; x0 += 6 + Math.floor(hash(x0) * 4)) {
        const h = 5 + Math.floor(hash(x0 * 1.7) * 4)
        for (let k = 0; k < h; k++) {
          const half = Math.floor(k / 2)
          for (let dx = -half; dx <= half; dx++) c.set(x0 + dx, H - 3 - h + k + 1, dx < 0 ? accent : color)
        }
      }
      return
    }
    case 'stalactites': {
      for (let x = 0; x < W; x++) c.set(x, 0, color)
      for (const tip of stalactites(W)) {
        for (let k = 0; k < tip.len; k++) {
          const half = Math.max(0, Math.floor((tip.len - k) / 2) - 1)
          for (let dx = -half; dx <= half; dx++) c.set(tip.x + dx, 1 + k, dx < 0 ? accent : color)
        }
      }
      return
    }
    case 'shelves': {
      for (const plank of [H - 8, H - 14]) {
        if (plank < 3) continue
        for (let x = 0; x < W; x++) c.set(x, plank, accent)
        for (let x = 1; x < W - 1; x++) {
          if (hash(x * 2.3 + plank) < 0.18) continue
          const tall = hash(x * 4.1 + plank) < 0.5 ? 3 : 2
          const spine = bookColor(Math.floor(hash(x * 7.7 + plank) * 6))
          for (let y = plank - tall; y < plank; y++) c.set(x, y, spine)
        }
      }
      return
    }
    case 'sea': {
      const top = H - 6
      for (let y = top; y <= H - 3; y++) for (let x = 0; x < W; x++) c.set(x, y, color)
      // wave crests: short dashes drifting along the water
      for (let x0 = 0; x0 < W + 12; x0 += 9) {
        const x = ((x0 + Math.floor(now / 250)) % (W + 12)) - 6
        const y = top + 1 + (Math.floor(x0 / 9) % 2) * 2
        c.set(x, y, accent)
        c.set(x + 1, y, accent)
        c.set(x + 2, y, accent)
      }
      return
    }
  }
}

function stalactites(W: number) {
  const tips: { x: number; len: number }[] = []
  for (let x = 3; x < W - 2; x += 7 + Math.floor(hash(x * 1.3) * 6)) tips.push({ x, len: 3 + Math.floor(hash(x * 2.9) * 4) })
  return tips
}

function drawMotes(c: Canvas, look: Look, now: number) {
  const { color, motion, count } = look.mote
  const W = c.columns
  const H = c.height
  const t = now / 1000
  if (motion === 'drip') {
    // drops fall from the stalactite tips, a 2-pixel streak each
    const tips = stalactites(W)
    for (let k = 0; k < Math.min(count, tips.length); k++) {
      const tip = tips[Math.floor(hash(k * 7.3) * tips.length)]!
      const span = H - 3 - (tip.len + 1)
      const y = tip.len + 1 + ((t * 9 + k * 5) % (span + 6))
      if (y > H - 3) continue
      c.set(tip.x, y, color)
      c.set(tip.x, y - 1, P.navy)
    }
    return
  }
  if (count === 0) return
  const n = Math.max(1, Math.round((count * W) / 100))
  for (let k = 0; k < n; k++) {
    const seedX = hash(k * 12.1) * W
    const seedY = 2 + hash(k * 4.7) * (H - 8)
    const phase = hash(k * 3.3) * 6
    let x = seedX
    let y = seedY
    switch (motion) {
      case 'drift':
        x = (seedX + t * 2) % W
        y = seedY + Math.sin(t * 0.8 + phase) * 1.5
        break
      case 'rise':
        y = H - 4 - ((seedY + t * 2) % (H - 6))
        x = seedX + Math.sin(t + phase)
        break
      case 'twinkle':
        if (Math.sin(t * 1.7 + phase * 3) < 0.3) continue
        x = seedX + Math.sin(t * 0.5 + phase) * 2
        y = seedY + Math.cos(t * 0.7 + phase)
        break
    }
    c.set(x, y, color)
  }
}

function drawGround(c: Canvas, look: Look) {
  const W = c.columns
  const H = c.height
  c.rect(0, H - 2, W, 1, look.grass)
  c.rect(0, H - 1, W, 1, look.dirt)
  // texture in deliberate clusters on a loose rhythm, never single random pixels
  for (let x = 2; x < W; x += 7 + Math.floor(hash(x) * 5)) {
    c.set(x, H - 2, look.grassHi)
    c.set(x + 1, H - 2, look.grassHi)
    c.set(x + 3, H - 1, look.dirtDark)
    c.set(x + 4, H - 1, look.dirtDark)
    if (look.tufts && hash(x * 1.9) < 0.55) {
      c.set(x, H - 3, look.grass)
      c.set(x + 1, H - 3, look.grass)
      c.set(x + 1, H - 4, look.grassHi)
    }
  }
}

function propWidth(prop: Prop): number {
  if (prop.kind === 'sign') return [...(prop.label ?? '?')].length + 4
  return PROPS[prop.kind].rows[0]!.length
}

export function sayTime(text: string) {
  return clamp(2.5 + text.length * 0.07, 3.5, 9)
}

/** Seconds of stillness after a beat: the "put it down, take a breath" between actions. */
function restAfter(beat: Beat, jitter: number): number {
  const base: Partial<Record<Beat['do'], number>> = {
    carry: 1.6, drop: 1.6, squash: 1.6, transform: 1.8, plant_sign: 1.6, pull_sign: 1.6, look: 1.2, dig: 1.4, type: 1.4,
    say: 1.0, think: 1.0, emote: 0.8, walk: 0.6, run: 0.8,
    ponder: 0.4, wait: 0.3, hat: 1.0,
  }
  return ((base[beat.do] ?? 1.0) + jitter * 0.6) * 1000
}

export function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  // lengths in code points: one to a cell
  const len = (s: string) => [...s].length
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = len(word) > width ? [...word].slice(0, width - 1).join('') + '…' : word
    if (!line) line = w
    else if (len(line) + 1 + len(w) <= width) line += ' ' + w
    else {
      lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function hash(n: number) {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return s - Math.floor(s)
}
