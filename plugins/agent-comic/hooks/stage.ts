// The stage: plays the scenes' beats with the Claude figure, one after another, and draws each frame.
// It keeps the world on stage as the beats change it (props moved, transformed, squashed; signs
// planted and pulled), and hands the figure to the hub between turns (home.ts) while the subagents'
// small Claudes come and go beside him (helpers.ts).

import { drawBackdrop, drawProgress } from './backdrop'
import type { Ambience } from './backdrop'
import { HAMMER_SECS, HOP_SECS, LIFT_SECS, LOOK_SECS, PACES, RUN_FACTOR, TYPE_SECS, handlingSecs, heldSecs, restAfter, sayTime } from './beats'
import type { Pace } from './beats'
import { bubbleRect, drawBubble, layoutBubble } from './bubble'
import type { Bubble, BubbleKind, Rect } from './bubble'
import { Canvas, cellWidth } from './canvas'
import { drawEffect, drawParticle, fly } from './effects'
import type { Effect, EffectKind, Particle } from './effects'
import { Figure } from './figure'
import type { StageHost } from './figure'
import { Helpers } from './helpers'
import { Home } from './home'
import { DOOR } from './hubart'
import { drawProp, freeCol, leastCrowdedCol, propSpan, propWidth, signBoard, signWidth } from './props'
import type { PropLook, SignMotion, Span } from './props'
import type { Beat, Hat, Mood, Prop, Scene, Setting } from './scene'
import { BALLOON, BITS, CLAUDE_HEIGHT, CLAUDE_WIDTH, HATS_ART, LOOKS, MOOD_ICONS, P, PENNANT, PROPS, SIGN, TINTS, claude } from './sprites'
import type { Arm, Face, Tint } from './sprites'
import { clamp } from './util'

const DOZE_MS = 120_000 // idle this long and Claude falls asleep (or, between turns, goes home)
const HOME_DOZE_MS = 15_000 // back home, he naps soon
const MAX_SCENE_MS = 30_000 // a scene this old gives way to a waiting one mid-play
const CUT_AFTER = 3 // beats a scene plays before news may end it at its next pause
const MAX_WAITING = 3 // scenes queued behind the one playing
const MAX_PLANTED_SIGNS = 2 // signs of Claude's own standing at once
const DOOR_WIDTH = DOOR.closed[0]!.length

/** How each mood shows: the face it wears, its tint, and what it gives off per second. */
const MOOD_LOOK: Record<Mood, { face: Face; tint: Tint; effect?: EffectKind; rate?: number }> = {
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

/** Why Claude needs the person: a permission prompt, or a question put to them. */
export type Attention = 'permission' | 'question'

/** The world on stage: what the next scene finds, `gone` the props squashed or pulled out of it. */
export type StageWorld = { setting: Setting; props: Prop[]; gone: string[]; hat: Hat }

type BeatOf<K extends Beat['do']> = Extract<Beat, { do: K }>
/** The beat under way: when it began, and how far its phases got. */
type Run = { beat: Beat; start: number; phase: number; phaseAt: number; fromX?: number; target?: number }

const EMPTY: Scene = { setting: 'meadow', mood: 'neutral', props: [], beats: [] }

export class Stage {
  /** Walk speed and rest length; /config's pace sets it. */
  pace: Pace = PACES.calm
  /** Set while the director stages the next scene: a thought bubble of dots once the stage runs dry. */
  pondering = false
  /** The hour and the weather the sky shows (outdoor settings only, and only a little). */
  ambience: Ambience = { hour: 12, weather: 'clear' }
  /** The agent's task list: a trail along the ground, lit as tasks are done. */
  progress: { done: number; total: number } | null = null
  /** Signs at the band's edges to the places beside this one, by name; null draws none. */
  routeSigns: { left: string | null; right: string | null } | null = null
  /** Called as a queued scene begins to play. */
  onPlay: ((scene: Scene) => void) | null = null
  /** Called once the world on stage changed: a prop transformed, a new hat, new scenery stepped into. */
  onWorldChange: ((world: Omit<StageWorld, 'gone'>) => void) | null = null

  readonly figure = new Figure()
  /** The hub, where the session opens and Claude goes between turns. */
  readonly home: Home
  /** The subagents' small Claudes. */
  readonly helpers: Helpers

  // the scene playing and the ones waiting behind it
  private scene: Scene = EMPTY
  private waiting: Scene[] = []
  private index = 0 // the next beat of `scene`
  private run: Run | null = null
  private sceneStart = 0
  private restUntil = 0 // a breath between two actions
  private idleSince: number | null = null
  private isPendingUrgent = false

  // the world as the beats have changed it
  private removed = new Set<string>() // props squashed or pulled out
  private placed = new Map<string, number>() // every prop's column, once laid out or moved
  private carrying: string | null = null
  private planted = new Set<string>() // signs Claude hammered in
  private signMotion = new Map<string, SignMotion>()
  private pennants: number[] = [] // commits: little flags planted in this world, by column
  /** A door Claude summoned into the world: he walks through it into new scenery, queued behind it. */
  private portal: { col: number; phase: 'appear' | 'walk' | 'open' | 'in'; at: number } | null = null

  // what he shows and gives off
  private emote: { mood: Mood; until: number } | null = null
  private balloon: { mood: Mood; until: number } | null = null
  private bubble: { text: string; kind: 'say' | 'think'; until: number } | null = null
  private reaction: { glyph: string; until: number } | null = null
  private cueMark: { glyph: string; color: number; until: number } | null = null
  private calling: Attention | null = null
  private callingSince = 0
  private dirt: Particle[] = []
  private effects: Effect[] = []

  private columns = 80
  private rows = 8
  private last = 0
  private now = 0

  constructor(private readonly rand: () => number = Math.random) {
    const stage = this
    const host: StageHost = {
      figure: this.figure,
      rand,
      get now() { return stage.now },
      get columns() { return stage.columns },
      get rows() { return stage.rows },
      get pace() { return stage.pace },
      give: (kind, x, y) => this.give(kind, x, y),
      fling: particle => {
        this.dirt.push(particle)
      },
      react: (glyph, ms) => {
        this.reaction = { glyph, until: this.now + ms }
      },
    }
    this.home = new Home(host)
    this.helpers = new Helpers(host)
  }

  /** The figure's column, for tools that follow it. */
  get figureColumn(): number {
    return Math.round(this.figure.x)
  }

  /** The time the stage was last stepped to. */
  get time(): number {
    return this.last
  }

  /** How long the figure has had nothing left to play (0 while a beat runs or a scene waits). */
  get idleMs(): number {
    return this.idleSince === null || this.waiting.length ? 0 : this.now - this.idleSince
  }

  /** The mood he shows now: dozing off when idle long, else the passing emote's, else the scene's. */
  get mood(): Mood {
    if (this.isDozing || this.home.isResting) return 'sleepy'
    return this.emote?.mood ?? this.scene.mood
  }

  /** The prop he holds overhead, if any. */
  get holding(): string | null {
    return this.carrying
  }

  /** How many beats of the playing scene have begun. */
  get beatsBegun(): number {
    return this.index
  }

  /** True at home: the hub, before the first turn or after a long idle. */
  get isHome(): boolean {
    return this.home.isHere
  }

  /** True while a summoned door is up or he is going through it. */
  get isTravelling(): boolean {
    return this.portal !== null
  }

  // ---- what plays ----

  /**
   * Plays `scene` once the current one has finished (or run past MAX_SCENE_MS),
   * so stories end before the next begins; `urgent` (the person's own commands) cuts in.
   */
  queue(scene: Scene, urgent = false) {
    if (!scene.continues) this.waiting = [] // a new world supersedes everything queued for the old one
    this.waiting.push(scene)
    // keep the queue short: drop the oldest continuation, never a scene that sets up a world
    while (this.waiting.length > MAX_WAITING) this.waiting.splice(this.waiting[0]!.continues ? 0 : 1, 1)
    if (urgent) this.isPendingUrgent = true
  }

  /** Plays `beats` next in the current world, then idles. */
  interject(beats: Beat[]) {
    this.waiting.unshift({ ...this.scene, mood: 'neutral', beats, continues: true })
    this.isPendingUrgent = true
  }

  /**
   * About how long until everything playing and queued has played out (ms): the
   * beats left, the walks between them and the rests after them. Close, not exact.
   */
  get remainingMs(): number {
    return this.estimateMs(false)
  }

  /**
   * About how long until a scene of news queued now would start (ms): the playing
   * scene gives way at its first pause after CUT_AFTER beats with nothing in hand.
   * With a scene already waiting, that one goes first and plays out.
   */
  get untilFreeMs(): number {
    return this.estimateMs(this.waiting.length === 0)
  }

  private estimateMs(isCut: boolean): number {
    let x = this.figure.x
    const maxX = this.figure.maxX
    const span = Math.max(1, this.columns - CLAUDE_WIDTH)
    // each beat's own time, and the walk to where it happens
    const beatSecs = (b: Beat, scene: Scene, isCurrent: boolean): number => {
      const colOf = (pct: number, id?: string) => (isCurrent ? this.col(pct, id) : (pct / 100) * span)
      const propCol = (id: string) => {
        const p = scene.props.find(q => q.id === id)
        return !p || (isCurrent && this.removed.has(id)) ? null : colOf(p.x, p.id)
      }
      const to = b.do === 'walk' || b.do === 'run' ? colOf(b.to) : b.do === 'plant_sign' ? colOf(b.x) : 'at' in b && b.at ? propCol(b.at) : null
      let walkSecs = 0
      if (to !== null) {
        walkSecs = Math.abs(clamp(to, 0, maxX) - x) / (b.do === 'run' ? this.pace.walk * RUN_FACTOR : this.pace.walk)
        x = clamp(to, 0, maxX)
      }
      return walkSecs + (heldSecs(b) ?? handlingSecs(b))
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
   * The turn's world as the next scene will find it: the props of the newest queued
   * world-setting scene, else the current props with their moves, changes and losses.
   */
  world(): StageWorld {
    const fresh = [...this.waiting].reverse().find(s => !s.continues)
    if (fresh) return { setting: fresh.setting, props: fresh.props.map(p => ({ ...p })), gone: [], hat: fresh.hat ?? 'none' }
    const span = Math.max(1, this.columns - CLAUDE_WIDTH)
    const props = this.scene.props
      .filter(p => !this.removed.has(p.id))
      .map(p => ({ ...p, x: Math.round((this.col(p.x, p.id) / span) * 100) }))
    return { setting: this.scene.setting, props, gone: [...this.removed], hat: this.scene.hat ?? 'none' }
  }

  /** The columns the prop `id` takes where it stands now. */
  spanOf(id: string): Span | undefined {
    const prop = this.scene.props.find(p => p.id === id)
    return prop && propSpan(prop, this.col(prop.x, prop.id))
  }

  private tellWorld() {
    const props = this.scene.props.filter(p => !this.removed.has(p.id)).map(p => ({ ...p }))
    this.onWorldChange?.({ setting: this.scene.setting, props, hat: this.scene.hat ?? 'none' })
  }

  // ---- moments that come from outside the scenes ----

  /**
   * A tool the agent just started (or one that failed): a small mark over Claude's
   * head at once, while the director is still staging it. He does not stop what he is doing.
   */
  cue(kind: 'read' | 'search' | 'edit' | 'run' | 'web' | 'fail') {
    const glyphs = { read: '≡', search: '⌕', edit: '✎', run: '»', web: '◌', fail: '!' }
    const isFail = kind === 'fail'
    // a failure stays up through the cues of the calls after it
    if (this.cueMark?.glyph === '!' && !isFail && this.cueMark.until > this.now) return
    this.cueMark = { glyph: glyphs[kind], color: isFail ? P.coral : P.silver, until: this.now + (isFail ? 2200 : 1400) }
    if (isFail) this.give('sweat')
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

  /** A pat from the person: hearts and a love balloon. */
  pet() {
    if (this.figure.hidden) return
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
    const fig = this.figure
    const col = fig.facing > 0 ? fig.x - 4 : fig.x + CLAUDE_WIDTH + 1
    this.pennants = [...this.pennants, clamp(Math.round(col), 0, Math.max(0, this.columns - 3))].slice(-3)
    this.give('sparkle')
    this.give('sparkle')
  }

  /**
   * The world moves to new scenery (the director's travel beat): whatever he was doing, he stops,
   * a door appears beside him with a puff, he walks through it and steps out into `scene` from the left.
   * At home (or already on his way through a door) the new world simply waits to load.
   */
  changeScenery(scene: Scene) {
    this.queue({ ...scene, continues: undefined })
    if (this.home.isHere || this.home.leaving || this.portal) return
    const fig = this.figure
    if (this.carrying) this.putDown()
    this.run = null
    this.bubble = null
    fig.settle()
    // ahead of him if it fits, else behind him
    const ahead = fig.facing > 0 ? fig.x + CLAUDE_WIDTH + 6 : fig.x - DOOR_WIDTH - 6
    const behind = fig.facing > 0 ? fig.x - DOOR_WIDTH - 6 : fig.x + CLAUDE_WIDTH + 6
    const room = Math.max(0, this.columns - DOOR_WIDTH - 1)
    const col = ahead >= 1 && ahead <= room ? Math.round(ahead) : clamp(Math.round(behind), 1, room)
    this.portal = { col, phase: 'appear', at: this.now }
    fig.facing = col > fig.x ? 1 : -1
    this.emote = { mood: 'surprised', until: this.now + 900 }
    const ground = this.rows * 2 - 2
    this.give('poof', col + Math.floor(DOOR_WIDTH / 2) - 1, ground - DOOR.closed.length)
    for (let k = 0; k < 4; k++) this.give('sparkle', col + Math.round(this.rand() * DOOR_WIDTH))
  }

  // ---- home ----

  /** The session opens at home, Claude standing by the door. */
  startHome() {
    this.settleHome()
    this.figure.x = this.home.startCol
  }

  /** Idle long enough between turns, and not home yet: time to go home. */
  get wantsHome(): boolean {
    return !this.home.isHere && !this.home.leaving && !this.portal && this.idleMs >= DOZE_MS - 1500
  }

  /** Back home through the door: it swings open and he steps out, to nap there soon. */
  goHome() {
    if (this.home.isHere || this.home.leaving) return
    this.settleHome()
    this.home.arrive()
  }

  /**
   * A new turn while home: he sprints for the door and goes through (the turn's world
   * loads once he is in, so he never keeps it waiting); woken from a nap, he starts up first.
   * False when he is not home (nothing to do).
   */
  leaveHome(): boolean {
    if (!this.home.isHere || this.home.leaving) return false
    const isWaking = this.isDozing || this.home.isResting
    this.home.leave(isWaking)
    this.emote = isWaking ? { mood: 'surprised', until: this.now + 700 } : null
    return true
  }

  private settleHome() {
    // whatever he was doing in the old world stays there
    this.run = null
    this.bubble = null
    this.emote = null
    this.figure.settle()
    this.waiting = []
    this.load({ ...EMPTY })
    this.home.enter()
    this.figure.hidden = false
    this.idleSince = null // idle from the next step, on its clock
  }

  // ---- the clock ----

  /** Advances the animation to `now` (ms). */
  step(now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0
    this.last = now
    this.now = now
    this.figure.moving = false
    this.dirt = fly(this.dirt, now, dt)
    this.effects = this.effects.filter(e => e.until > now)
    if (this.bubble && this.bubble.until < now) this.bubble = null
    if (this.reaction && this.reaction.until < now) this.reaction = null
    if (this.cueMark && this.cueMark.until < now) this.cueMark = null
    if (this.emote && this.emote.until < now) this.emote = null
    if (this.balloon && this.balloon.until < now) this.balloon = null

    // waiting on the person, on his way out of the hub or through a door: the scene holds still
    if (this.calling) return this.stepHelpers(dt)
    if (this.home.leaving) {
      this.home.stepLeaving(dt)
      return this.stepHelpers(dt)
    }
    if (this.portal) {
      this.stepPortal(dt)
      return this.stepHelpers(dt)
    }

    this.nextBeat(now)
    if (this.run) this.play(this.run, dt)
    else if (this.home.isRoaming) this.home.step(dt)
    else if (now >= this.restUntil) this.idle(dt)
    this.stepHelpers(dt)

    // what the mood gives off, at its rate
    const look = MOOD_LOOK[this.mood]
    if (look.effect && look.rate && this.rand() < look.rate * dt) this.give(look.effect)
  }

  private stepHelpers(dt: number) {
    this.helpers.step(dt, LOOKS[this.scene.setting].dirt)
  }

  /** Ends the beat that is done, and once its rest is over starts the next (the next scene's, if it is time). */
  private nextBeat(now: number) {
    if (this.run && this.isDone(this.run)) {
      // a breath between actions: longer after handling things or finding something
      this.restUntil = now + restAfter(this.run.beat, this.rand()) * this.pace.rest
      this.run = null
      this.figure.settle()
    }
    if (this.run || (now < this.restUntil && !this.isPendingUrgent)) return
    const isSceneOver = this.index >= this.scene.beats.length || now - this.sceneStart > MAX_SCENE_MS
    // news waiting: a scene that has had its say gives way at this pause, as long as his hands are free
    const isYielding = this.waiting[0]?.isNews === true && this.index >= CUT_AFTER && this.carrying === null
    if (this.waiting.length && (isSceneOver || isYielding || this.isPendingUrgent)) this.load(this.waiting.shift()!)
    const beat = now >= this.restUntil || this.index === 0 ? this.scene.beats[this.index] : undefined
    if (beat) {
      this.index++
      this.run = { beat, start: now, phase: 0, phaseAt: now }
      this.idleSince = null
    } else if (this.idleSince === null) {
      this.idleSince = now
    }
  }

  /**
   * Puts `scene` on stage. A continuation keeps the world as it is; a new world is laid out afresh,
   * and if he is coming from the hub or a door (`isEntering`) he steps into it from the left.
   */
  private load(scene: Scene, isEntering = this.home.isHere) {
    if (scene.continues) {
      // same world: keep its props as they now are (moved, transformed, squashed)
      scene = { ...scene, setting: this.scene.setting, props: this.scene.props, hat: this.scene.hat }
    } else {
      scene = { ...scene, props: scene.props.map(p => ({ ...p })) }
      if (isEntering) {
        this.home.exit()
        this.figure.hidden = false
        this.figure.x = 2
        this.figure.facing = 1
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

  /** The summoned door: it appears, he walks to it, it opens, he goes in, and the waiting world loads. */
  private stepPortal(dt: number) {
    const p = this.portal!
    const since = this.now - p.at
    if (p.phase === 'appear' && since >= 900) this.portal = { ...p, phase: 'walk', at: this.now }
    else if (p.phase === 'open' && since >= 500) {
      this.figure.hidden = true
      this.portal = { ...p, phase: 'in', at: this.now }
    } else if (p.phase === 'in' && since >= 600) {
      this.portal = null
      const next = this.waiting.findIndex(s => !s.continues)
      if (next < 0) {
        this.figure.hidden = false
        return
      }
      this.waiting.splice(0, next)
      // stepping out of a door, like coming from home: in from the left
      this.load(this.waiting.shift()!, true)
      this.tellWorld()
    }
    if (this.portal?.phase === 'walk' && this.walk(this.portal.col + Math.floor((DOOR_WIDTH - CLAUDE_WIDTH) / 2), dt)) {
      this.figure.facing = 1
      this.portal = { ...this.portal, phase: 'open', at: this.now }
    }
  }

  // ---- the beats ----

  private secs(run: Run): number {
    return (this.now - run.start) / 1000
  }

  private isDone(run: Run): boolean {
    const b = run.beat
    const held = heldSecs(b)
    if (held !== undefined) return this.secs(run) >= held
    switch (b.do) {
      case 'walk':
      case 'run': return Math.abs(this.figure.x - this.figure.within(this.col(b.to))) < 0.5
      case 'transform': return run.phase === 4
      case 'pull_sign': return run.phase === 3
      case 'travel': return true // the door takes over: changeScenery ends the beat itself
      default: return run.phase === 2 // look, squash, carry, type, plant_sign
    }
  }

  private play(run: Run, dt: number) {
    const b = run.beat
    const t = this.secs(run)
    const fig = this.figure
    switch (b.do) {
      case 'walk':
        this.walk(this.col(b.to), dt)
        break
      case 'run':
        if (!this.walk(this.col(b.to), dt, this.pace.walk * RUN_FACTOR) && this.rand() < 12 * dt) this.give('dust')
        break
      case 'say':
      case 'think':
        if (run.phase === 0) {
          this.bubble = { text: b.text, kind: b.do, until: this.now + ((b.secs ?? sayTime(b.text)) + 4) * 1000 }
          run.phase = 1
        }
        break
      case 'look':
      case 'squash':
      case 'carry':
      case 'type':
        this.playHandling(run, b, dt)
        break
      case 'drop':
        if (run.phase === 0) {
          this.putDown()
          run.phase = 1
        }
        break
      case 'plant_sign':
        this.playPlantSign(run, b, dt)
        break
      case 'pull_sign':
        this.playPullSign(run, b, dt)
        break
      case 'transform':
        this.playTransform(run, b, dt)
        break
      case 'hat':
        // a puff over his head, and he wears the new hat
        if (run.phase === 0) {
          this.give('poof', Math.round(fig.x + CLAUDE_WIDTH / 2) - 1, (fig.top ?? this.rows * 2 - 9) - 2)
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
        if (b.mood === 'surprised') fig.lift = t < 0.35 ? Math.sin((Math.PI * t) / 0.35) * 2 : 0
        if (b.mood === 'confused') fig.facing = Math.floor(t / 0.6) % 2 === 0 ? 1 : -1
        break
      case 'dance':
        fig.lift = Math.abs(Math.sin(Math.PI * t * 2)) * 2
        fig.facing = Math.floor(t * 2) % 2 === 0 ? 1 : -1
        if (this.rand() < 3 * dt) this.give('sparkle')
        break
      case 'jump':
        fig.lift = Math.sin(Math.PI * Math.min(1, t / 0.6)) * 4
        break
      case 'celebrate':
        fig.lift = Math.abs(Math.sin((Math.PI * t) / 0.5)) * 3
        if (this.rand() < 0.5) this.give('sparkle')
        break
      case 'dig': {
        // a stroke every 0.5 s: blade down (crouched), then up, flinging a clod over his shoulder
        const isDown = (t % 0.5) < 0.25
        fig.bob = isDown ? 1 : 0
        if (!isDown && (t - dt) % 0.5 < 0.25) for (let k = 0; k < 3; k++) this.throwDirt()
        break
      }
      case 'ponder':
        // stands still, looks one way, then turns to look the other way
        fig.looking = Math.floor(t / 1.2) % 2 === 1
        if (run.phase === 0 && t > (b.secs ?? 3) / 2) {
          fig.facing = fig.facing > 0 ? -1 : 1
          run.phase = 1
        }
        break
      case 'read':
      case 'wave':
      case 'shrug':
      case 'wait':
        break // drawn by the pose alone
    }
  }

  /** Look at, squash, carry or type at a prop: walk to it (phase 0), handle it (1), done (2). */
  private playHandling(run: Run, b: BeatOf<'look' | 'squash' | 'carry' | 'type'>, dt: number) {
    const fig = this.figure
    const prop = b.at ? this.prop(b.at) : undefined
    if (run.phase === 0) {
      if (b.at && !prop) {
        run.phase = 2 // it is gone: the beat passes
        return
      }
      if (!prop || this.approach(prop, dt)) {
        run.phase = 1
        run.phaseAt = this.now
        run.fromX = fig.x
        if (b.do === 'look') this.reaction = { glyph: b.react ?? '?', until: this.now + 1600 }
      }
      return
    }
    if (run.phase !== 1) return
    const p = (this.now - run.phaseAt) / 1000
    switch (b.do) {
      case 'look':
        fig.looking = true
        if (p >= LOOK_SECS) run.phase = 2
        return
      case 'type':
        fig.bob = Math.floor(this.now / 160) % 2
        if (p >= (b.secs ?? TYPE_SECS)) run.phase = 2
        return
      case 'carry':
        fig.lift = Math.min(1, p / LIFT_SECS)
        if (p >= LIFT_SECS && prop) {
          this.carrying = prop.id
          run.phase = 2
        }
        return
      case 'squash': {
        if (!prop) return
        // a hop that lands squarely on top of the bug
        const d = Math.min(1, p / HOP_SECS)
        const from = run.fromX ?? fig.x
        const onTop = this.col(prop.x, prop.id) + propWidth(prop) / 2 - CLAUDE_WIDTH / 2
        fig.x = from + (onTop - from) * d
        fig.facing = onTop >= from ? 1 : -1
        // the arc comes down onto the bug's back, not the grass beside it
        const perch = prop.kind === 'sign' ? 0 : PROPS[prop.kind].rows.length
        fig.lift = d < 0.5 ? Math.sin(Math.PI * d) * 6 : Math.max(perch, Math.sin(Math.PI * d) * 6)
        if (d >= 1) {
          this.removed.add(prop.id)
          this.give('poof', this.col(prop.x, prop.id) + 2, this.rows * 2 - 5)
          run.phase = 2
        }
      }
    }
  }

  /**
   * Hammers a sign in, in a free spot near where it was asked for: walk beside the spot (phase 0),
   * hammer the post in with dust at each blow while the board types itself in (1), done (2).
   * With no room anywhere, or already two of his signs standing, no sign goes up.
   */
  private playPlantSign(run: Run, b: BeatOf<'plant_sign'>, dt: number) {
    const fig = this.figure
    if (run.target === undefined) {
      const spot = freeCol({ id: b.id, kind: 'sign', x: b.x, label: b.label }, this.col(b.x), this.columns, this.standing(b.id))
      if (spot === null) {
        run.phase = 2
        return
      }
      run.target = spot
    }
    const at = run.target
    const width = signWidth(b.label)
    const p = (this.now - run.phaseAt) / 1000
    if (run.phase === 0) {
      const spot = at - CLAUDE_WIDTH - 1 >= 0 ? at - CLAUDE_WIDTH - 1 : at + width + 1
      if (!this.walk(spot, dt)) return
      fig.facing = spot < at ? 1 : -1
      const standing = [...this.planted].filter(id => !this.removed.has(id)).length
      if (standing >= MAX_PLANTED_SIGNS || this.scene.props.some(q => q.id === b.id && !this.removed.has(q.id))) {
        run.phase = 2 // no room for another sign (or it already stands): the beat passes
        return
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
      fig.bob = strike % 2
      if (fig.bob === 0 && Math.floor((p - dt) / 0.35) !== strike) {
        this.give('dust', at + Math.floor(width / 2) - 2, this.rows * 2 - 3)
      }
      if (p >= HAMMER_SECS) {
        fig.bob = 0
        this.signMotion.delete(b.id)
        run.phase = 2
      }
    }
  }

  /** Pulls a sign out: walk to it (phase 0), tug it loose (1), it rises out of the ground (2) and vanishes in a puff (3). */
  private playPullSign(run: Run, b: BeatOf<'pull_sign'>, dt: number) {
    const fig = this.figure
    const prop = this.prop(b.at)
    if (!prop || prop.kind !== 'sign') {
      run.phase = 3
      return
    }
    const p = (this.now - run.phaseAt) / 1000
    if (run.phase === 0) {
      if (this.approach(prop, dt)) {
        run.phase = 1
        run.phaseAt = this.now
        this.signMotion.set(prop.id, { kind: 'shake', start: this.now, ms: 1400 })
      }
    } else if (run.phase === 1) {
      fig.bob = Math.floor(p / 0.25) % 2
      if (p >= 1.4) {
        fig.bob = 0
        fig.lift = 1
        run.phase = 2
        run.phaseAt = this.now
        this.signMotion.set(prop.id, { kind: 'rise', start: this.now, ms: 700 })
      }
    } else if (run.phase === 2 && p >= 0.7) {
      this.give('poof', this.col(prop.x, prop.id) + Math.floor(signWidth(prop.label) / 2) - 1, this.rows * 2 - 10)
      this.removed.add(prop.id)
      this.signMotion.delete(prop.id)
      fig.lift = 0
      run.phase = 3
    }
  }

  /** Lifts a prop overhead (phases 0-1), a puff of magic smoke and it is something else (2), set down (3), done (4). */
  private playTransform(run: Run, b: BeatOf<'transform'>, dt: number) {
    const fig = this.figure
    const prop = this.carrying === b.at ? this.scene.props.find(p => p.id === b.at) : this.prop(b.at)
    if (!prop) {
      run.phase = 4
      return
    }
    const p = (this.now - run.phaseAt) / 1000
    const next = (phase: number) => {
      run.phase = phase
      run.phaseAt = this.now
    }
    if (run.phase === 0) {
      if (this.carrying === prop.id || this.approach(prop, dt)) next(1)
    } else if (run.phase === 1) {
      fig.lift = Math.min(1, p / LIFT_SECS)
      if (p >= LIFT_SECS) {
        this.carrying = prop.id
        next(2)
      }
    } else if (run.phase === 2 && p >= 0.7) {
      this.give('poof', Math.round(fig.x + CLAUDE_WIDTH / 2) - 1, (fig.top ?? this.rows * 2 - 9) - 3)
      for (let k = 0; k < 4; k++) this.give('sparkle')
      prop.kind = b.into
      prop.label = b.label
      next(3)
      this.tellWorld()
    } else if (run.phase === 3 && p >= 1.0) {
      this.putDown()
      next(4)
    }
  }

  /** Nothing to play: now and then a short stroll, unless he is dozing off. */
  private idle(dt: number) {
    const fig = this.figure
    fig.bob = 0
    if (this.mood === 'sleepy') return
    if (fig.strollTo !== null) {
      if (this.walk(fig.strollTo, dt * 0.5)) fig.strollTo = null
    } else if (this.now > fig.strollAt) {
      fig.strollAt = this.now + 3000 + this.rand() * 4000
      if (this.rand() < 0.6) fig.strollTo = fig.within(fig.x + (this.rand() * 16 - 8))
    }
  }

  private get isDozing(): boolean {
    const dozeMs = this.home.isHere && this.home.isNapping ? HOME_DOZE_MS : DOZE_MS
    return !this.emote && !this.run && !this.calling && !this.home.isBusy && this.idleMs >= dozeMs
  }

  /** Moves him toward `target` at the stage's pace (or `speed`); true once there. */
  private walk(target: number, dt: number, speed = this.pace.walk): boolean {
    return this.figure.walk(target, dt, speed)
  }

  /** Walks beside a prop and turns to it; true once there. */
  private approach(prop: Prop, dt: number): boolean {
    const fig = this.figure
    const at = this.col(prop.x, prop.id)
    const side = fig.x + CLAUDE_WIDTH / 2 < at ? -1 : 1
    const spot = side < 0 ? at - CLAUDE_WIDTH - 1 : at + propWidth(prop) + 1
    if (!this.walk(spot, dt)) return false
    fig.facing = side < 0 ? 1 : -1
    return true
  }

  /** Starts an effect near his head (or at a given pixel). */
  private give(kind: EffectKind, x?: number, y?: number) {
    const fig = this.figure
    // the sprite's real top edge as last drawn: a slumped or crouched figure is a pixel lower
    const head = fig.headTop(this.rows)
    const mid = fig.x + CLAUDE_WIDTH / 2
    const now = this.now
    const at = (x: number, y: number, ms: number) => ({ x, y, start: now, until: now + ms })
    switch (kind) {
      case 'sparkle': {
        const color = [P.yellow, P.white, P.coral, P.sky][Math.floor(this.rand() * 4)]!
        this.effects.push({
          kind, color, start: now, until: now + 450,
          x: x ?? Math.round(fig.x + this.rand() * (CLAUDE_WIDTH + 8) - 4),
          y: y ?? 1 + Math.floor(this.rand() * Math.max(1, this.rows * 2 - 8)),
        })
        return
      }
      case 'heart':
        // beside the head, left or right, so a balloon above it never hides them
        this.effects.push({ kind, ...at(Math.round(mid + (this.rand() < 0.5 ? -10 : 6)), head - 2, 1400) })
        return
      case 'tear': {
        // from under one of the drooping eyes (rows 2-3, columns 3 and 7: the same either way he faces)
        const eye = fig.x + (this.rand() < 0.5 ? 3 : 7)
        this.effects.push({ kind, ...at(Math.round(eye), head + 4, 700) })
        return
      }
      case 'steam': {
        const side = this.rand() < 0.5 ? fig.x + 1 : fig.x + CLAUDE_WIDTH - 3
        this.effects.push({ kind, ...at(Math.round(side), head - 1, 600) })
        return
      }
      case 'sweat': {
        const side = fig.facing > 0 ? fig.x + CLAUDE_WIDTH - 2 : fig.x + 1
        this.effects.push({ kind, ...at(Math.round(side), head, 900) })
        return
      }
      case 'zzz':
        this.effects.push({ kind, ...at(Math.round(mid + 3), head - 2, 2200) })
        return
      case 'dust': {
        const heel = fig.facing > 0 ? fig.x - 1 : fig.x + CLAUDE_WIDTH - 1
        this.effects.push({ kind, ...at(Math.round(x ?? heel), y ?? this.rows * 2 - 3, 350) })
        return
      }
      case 'poof':
        this.effects.push({ kind, ...at(x ?? Math.round(mid), y ?? head, 600) })
        return
      case 'balloon': {
        const hand = fig.facing > 0 ? fig.x + CLAUDE_WIDTH - 1 : fig.x - 2
        this.effects.push({ kind, ...at(Math.round(x ?? hand), y ?? head - 2, 4500) })
        return
      }
    }
  }

  /** A clod off the blade in front, in a high arc back over his head (drawn behind him). */
  private throwDirt() {
    const fig = this.figure
    const blade = fig.facing > 0 ? fig.x + CLAUDE_WIDTH + 1 : fig.x - 3
    const look = LOOKS[this.scene.setting]
    this.dirt.push({
      x: blade,
      y: this.rows * 2 - 4,
      vx: -fig.facing * (14 + this.rand() * 10),
      vy: -(26 + this.rand() * 6), // peaks well above his head, so no clod lands on it
      until: this.now + 650,
      color: this.rand() < 0.6 ? look.dirt : look.grassHi,
    })
  }

  // ---- props on the ground ----

  /** The prop `id` if it stands on the ground (not gone, not in his hands). */
  private prop(id: string): Prop | undefined {
    return this.removed.has(id) || this.carrying === id ? undefined : this.scene.props.find(p => p.id === id)
  }

  /** Sets down whatever he carries, just in front of him. */
  private putDown() {
    const fig = this.figure
    const prop = this.scene.props.find(p => p.id === this.carrying)
    if (prop) {
      const w = propWidth(prop)
      const want = fig.facing > 0 ? fig.x + CLAUDE_WIDTH + 1 : fig.x - w - 1
      const near = clamp(Math.round(want), 0, this.columns - w)
      const at = freeCol(prop, near, this.columns, this.standing(prop.id)) ?? leastCrowdedCol(prop, near, this.columns, this.standing(prop.id))
      this.placed.set(prop.id, at)
      this.give('dust', fig.facing > 0 ? at : at + w - 2, this.rows * 2 - 3)
    }
    this.carrying = null
  }

  /** The spans of every prop on the ground, except `exceptId`. */
  private standing(exceptId?: string): Span[] {
    return this.scene.props
      .filter(p => p.id !== exceptId && !this.removed.has(p.id) && this.carrying !== p.id)
      .map(p => propSpan(p, this.col(p.x, p.id)))
  }

  /** Lays a new world's props out left to right, each at the free spot nearest where it was asked for. */
  private arrange() {
    const laid: Span[] = []
    const byPlace = [...this.scene.props].sort((a, b) => a.x - b.x)
    for (const prop of byPlace) {
      const want = this.col(prop.x)
      const col = freeCol(prop, want, this.columns, laid) ?? leastCrowdedCol(prop, want, this.columns, laid)
      this.placed.set(prop.id, col)
      laid.push(propSpan(prop, col))
    }
  }

  /** A 0..100 position as a column; a prop that was laid out or moved keeps its own. */
  private col(pct: number, id?: string): number {
    const placed = id === undefined ? undefined : this.placed.get(id)
    return placed ?? Math.round((pct / 100) * this.figure.maxX)
  }

  // ---- drawing ----

  /** Draws the frame for a band of `columns` by `rows` and encodes it. */
  frame(columns: number, rows: number): string {
    return this.frameCanvas(columns, rows).encode()
  }

  /** Draws the frame for a band of `columns` by `rows`, back to front. */
  frameCanvas(columns: number, rows: number): Canvas {
    if (columns !== this.columns || rows !== this.rows) {
      this.columns = columns
      this.rows = rows
      this.figure.columns = columns
      this.figure.x = this.figure.within(this.figure.x)
    }
    const c = new Canvas(columns, rows)
    const ground = rows * 2 - 2
    const now = this.now
    const fig = this.figure

    // the scenery: sky, far layer, motes, ground, then the hub or the summoned door, and the commits' flags
    drawBackdrop(c, this.home.isHere ? this.home.look : LOOKS[this.scene.setting], now, this.ambience)
    if (this.progress && this.progress.total > 0) drawProgress(c, this.progress)
    if (this.home.isHere) this.home.draw(c, ground)
    if (this.portal) {
      const door = this.portal.phase === 'open' || this.portal.phase === 'in' ? DOOR.open : DOOR.closed
      c.sprite(this.portal.col, ground - door.length, door, DOOR.palette)
    }
    for (const col of this.pennants) c.sprite(col, ground - PENNANT.rows.length, PENNANT.rows, PENNANT.palette)

    // the bubble is laid out before anything is drawn, so a sign board it would cut into is left out
    const bubble = this.layoutBubble()
    const propLook = (id: string): PropLook => ({
      now,
      motion: this.signMotion.get(id),
      isTyping: this.run?.beat.do === 'type' && this.run.phase === 1,
      bubble: bubble ? bubbleRect(bubble) : null,
    })
    for (const prop of this.scene.props) {
      if (this.removed.has(prop.id) || this.carrying === prop.id) continue
      drawProp(c, prop, this.col(prop.x, prop.id), ground, propLook(prop.id))
    }
    for (const p of this.dirt) drawParticle(c, p)
    this.helpers.draw(c)

    const figure = this.figureSprite(ground)
    if (fig.hidden || this.home.isResting) {
      // through a door, or in bed
      if (this.home.isResting) fig.top = this.home.drawInBed(c, ground, this.calling !== null)
      this.drawRouteSigns(c)
      this.drawEffects(c)
      if (bubble) drawBubble(c, bubble)
      return c
    }

    const { left, top, hatRise } = this.drawFigure(c, ground, figure)
    // what he holds
    const beat = this.run?.beat.do
    if (beat === 'dig') {
      const tool = fig.bob ? BITS.shovel : BITS.shovelUp
      const sx = fig.facing > 0 ? left + CLAUDE_WIDTH - 1 : left - 3
      c.sprite(sx, top + 1 + fig.bob, tool.rows, tool.palette, fig.facing < 0)
    }
    if (beat === 'read') {
      const book = Math.floor(now / 900) % 3 === 2 ? BITS.bookFlip : BITS.book
      // held low and centred, below the downcast eyes, so it never covers one
      c.sprite(left + 3, top + 4, book.rows, book.palette, fig.facing < 0)
    }
    const held = this.scene.props.find(p => p.id === this.carrying)
    if (held) drawProp(c, held, Math.round(left + CLAUDE_WIDTH / 2 - propWidth(held) / 2), top, propLook(held.id))

    this.drawBalloon(c, top, hatRise)
    this.drawEffects(c)
    this.drawMarks(c, hatRise)
    if (this.home.isHere) this.home.drawLabels(c)
    this.drawRouteSigns(c)
    const caption = this.run?.beat.caption
    if (caption) c.text(0, 0, ` ${caption} `.slice(0, columns), P.white, P.slate)
    if (bubble) drawBubble(c, bubble)
    return c
  }

  /** The face and arms for this moment: the beat's own, else the mood's. */
  private pose(): { face: Face; back: Arm; front: Arm; tint: Tint } {
    const now = this.now
    const mood = MOOD_LOOK[this.mood]
    let face: Face = this.figure.looking ? 'right' : mood.face
    let back: Arm = 'down'
    let front: Arm = 'down'
    const flip = (ms: number) => Math.floor(now / ms) % 2 === 0
    const phase = this.run?.phase
    switch (phase === 0 || phase === 1 ? this.run!.beat.do : undefined) {
      case 'read': face = 'down'; front = 'mid'; break
      case 'ponder': front = 'mid'; break
      case 'type':
        if (phase === 1) {
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
      case 'plant_sign': if (phase === 1) front = this.figure.bob ? 'mid' : 'up'; break
      case 'pull_sign': if (phase) { front = 'mid'; back = 'mid' } break
    }
    if (this.carrying) {
      back = 'up'
      front = 'up'
    }
    if (this.home.isSprinting) {
      // sprinting for the door, arms out like a run
      back = 'mid'
      front = 'mid'
    }
    if (this.home.isWatching) face = this.reaction ? 'happy' : 'right'
    if (this.home.isTending) {
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

  /** His sprite this frame and where it stands; its top is kept for whatever goes over his head. */
  private figureSprite(ground: number): { art: string[]; tint: Tint; left: number; top: number } {
    const now = this.now
    const fig = this.figure
    const mood = this.mood
    const pose = this.pose()
    const isStill = !fig.moving && fig.lift < 0.5
    const breathMs = mood === 'sleepy' ? 1400 : 700
    const isFast = this.run?.beat.do === 'run' || this.home.leaving?.isSprint
    // angry and worried figures shake; everyone else stands still
    const shake = (mood === 'angry' || mood === 'worried') && Math.floor(now / 90) % 2 === 0 ? 1 : 0
    const art = claude({
      ...pose,
      walk: fig.moving ? Math.floor(now / (isFast ? 70 : 120)) : 0,
      airborne: fig.lift > 1,
      crouch: mood === 'sad' || this.home.isWatching || fig.bob > 0 || (isStill && Math.floor(now / breathMs) % 2 === 1),
      left: fig.facing < 0,
    })
    // the sprite stands on the ground; a crouch is shorter, so the head drops one pixel
    const top = ground - art.length - Math.round(fig.lift)
    fig.top = top
    return { art, tint: pose.tint, left: Math.round(fig.x) + shake, top }
  }

  /** The figure, with what sits in front of him at home, and his hat; answers where it went. */
  private drawFigure(c: Canvas, ground: number, sprite: { art: string[]; tint: Tint; left: number; top: number }) {
    const fig = this.figure
    const { left, top } = sprite
    c.sprite(left, top - this.home.seatLift, sprite.art, TINTS[sprite.tint])
    this.home.drawInFront(c, ground, left, top)

    // the hat: the scene's, or a nightcap while he dozes; tucked away while something rides overhead
    const hatName = this.isDozing ? 'nightcap' : this.scene.hat ?? 'none'
    const hat = hatName === 'none' || this.carrying ? null : HATS_ART[hatName]
    const hatRise = hat ? hat.rows.length - hat.sit : 0
    if (hat) c.sprite(left, top - hatRise, hat.rows, hat.palette, fig.facing < 0)
    return { left, top, hatRise }
  }

  /** The mood balloon, popping up above his head (and hat); beside it when a tall hat leaves no room. */
  private drawBalloon(c: Canvas, top: number, hatRise: number) {
    if (!this.balloon || this.balloon.mood === 'neutral') return
    const { x } = this.figure
    const columns = this.columns
    // the first 120 ms it sits two pixels lower
    const pop = this.now - (this.balloon.until - 2500) < 120 ? 2 : 0
    let bx = clamp(Math.round(x + CLAUDE_WIDTH / 2 - 3), 0, columns - 9)
    let by = top - 9 - hatRise + pop
    if (by < 0) {
      bx = x + CLAUDE_WIDTH + 10 <= columns ? Math.round(x + CLAUDE_WIDTH + 1) : Math.max(0, Math.round(x - 10))
      by = Math.max(0, top - 6 + pop)
    }
    c.sprite(bx, by, BALLOON.rows, BALLOON.palette)
    const icon = MOOD_ICONS[this.balloon.mood]
    c.sprite(bx + 2, by + 1, icon.rows, icon.palette)
  }

  private drawEffects(c: Canvas) {
    for (const e of this.effects) drawEffect(c, e, this.now)
  }

  /** A reaction over his head; else a tool cue just off it, out of the way of a mood balloon. */
  private drawMarks(c: Canvas, hatRise: number) {
    const center = Math.round(this.figure.x + CLAUDE_WIDTH / 2)
    const row = Math.max(0, this.headRow() - 1 - Math.ceil(hatRise / 2))
    if (this.reaction) c.text(center, row, this.reaction.glyph, P.yellow)
    else if (this.cueMark && !this.balloon) c.text(center + 1, row, this.cueMark.glyph, this.cueMark.color)
  }

  /**
   * A wooden sign in each top corner that has one: "◂ name" at the left, "name ▸" at the right.
   * They hang up there, clear of the keepsakes and their titles along the ground.
   */
  private drawRouteSigns(c: Canvas) {
    if (!this.routeSigns) return
    const { left, right } = this.routeSigns
    if (left) c.box(0, 0, [`◂ ${left}`], SIGN.fg, SIGN.bg, SIGN.border)
    if (right) {
      const label = `${right} ▸`
      c.box(Math.max(0, this.columns - cellWidth(label) - 4), 0, [label], SIGN.fg, SIGN.bg, SIGN.border)
    }
  }

  /** The cell row of his head, standing as he is. */
  private headRow(): number {
    return Math.floor((this.rows * 2 - 2 - CLAUDE_HEIGHT - Math.round(this.figure.lift)) / 2)
  }

  /** What bubble shows this frame, laid out clear of the sign boards: the call, a remark, or the director's dots. */
  private layoutBubble(): Bubble | null {
    const show = (text: string, kind: BubbleKind) => {
      const at = { x: this.figure.x, headRow: this.headRow(), columns: this.columns, rows: this.rows }
      return layoutBubble(text, kind, at, this.signBoards())
    }
    if (this.calling) return show(this.calling === 'question' ? 'A question for you ▸' : 'Needs your OK ▸', 'call')
    if (this.bubble) return show(this.bubble.text, this.bubble.kind)
    // the director is asked ahead now, so its dots show only once the stage has run dry
    if ((this.pondering && this.idleSince !== null) || this.run?.beat.do === 'ponder') {
      return show('.'.repeat(1 + (Math.floor(this.now / 400) % 3)).padEnd(3), 'think')
    }
    return null
  }

  /** The board of every standing sign. */
  private signBoards(): Rect[] {
    return this.scene.props
      .filter(p => p.kind === 'sign' && !this.removed.has(p.id) && this.carrying !== p.id)
      .map(p => signBoard(p, this.col(p.x, p.id), this.rows))
  }
}
