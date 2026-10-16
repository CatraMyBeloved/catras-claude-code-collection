// The hub: Claude's home, three rooms side by side (garden, hall, den) with a door to the turn's
// world in each. While nothing calls him away he keeps busy at random, like a screensaver: he waters
// the flowers, strolls past his keepsakes, watches a film or lies down for a rest. A new turn has him
// sprint for the door; after a long idle he comes back through it.

import type { Canvas } from './canvas'
import { DEFAULT, cellWidth } from './canvas'
import type { Facing, StageHost } from './figure'
import type { HubItem } from './hub'
import {
  BED, BED_HEAD_X, BED_OVER, COUCH_BACK, COUCH_FRONT, DEN_LOOK, DOOR, FLOWER_COLORS, FLOWER_STAGES, FLOWER_WIDTH, GARDEN_LOOK,
  HUB_ART, HUB_LOOK, SLEEP_CAP, TV, TV_SCREEN, WATERING_CAN, claudeLying, flowerPalette,
} from './hubart'
import { CLAUDE_WIDTH, P, TINTS } from './sprites'
import type { Look } from './sprites'
import { RUN_FACTOR } from './beats'
import { clamp } from './util'

/** The hub's rooms, left to right. */
const ROOMS = ['garden', 'hall', 'den'] as const
export type Room = (typeof ROOMS)[number]
const ROOM_LOOK: Record<Room, Look> = { garden: GARDEN_LOOK, hall: HUB_LOOK, den: DEN_LOOK }

export type Pastime = 'admire' | 'tend' | 'rest' | 'movie'
/** Each pastime's room, how often it is picked, and how long it lasts (s). */
const PASTIMES: Record<Pastime, { room: Room; weight: number; secs: [number, number] }> = {
  admire: { room: 'hall', weight: 2, secs: [15, 30] },
  tend: { room: 'garden', weight: 3, secs: [25, 45] },
  rest: { room: 'den', weight: 2, secs: [30, 60] },
  movie: { room: 'den', weight: 3, secs: [30, 60] },
}

const DOOR_WIDTH = DOOR.closed[0]!.length
const KEEPSAKE_WIDTH = 7
const KEEPSAKE_GAP = 5 // columns between two keepsakes
const HOME_PACE = 0.6 // he strolls about at home
const FLOWER_COUNT = 5
const FLOWER_STEP = 7 // columns from one flower to the next
const WATER_SECS = 5 // one flower's watering
const SIT_LIFT = 2 // seated on the couch he sits this many pixels up, his legs behind its front
const NEW_ITEM_MS = 6000 // a new keepsake's title stays bright this long

type Leaving = { phase: 'wake' | 'walk' | 'open' | 'in'; at: number; isSprint: boolean }
type Doing = { kind: Pastime; phase: 'go' | 'do'; until: number; next: number; flower: number }
type Label = { col: number; row: number; text: string; color: number }

export class Home {
  /** The hub is on stage: from the session's start, or coming home, until the turn's world loads. */
  isHere = false
  /** He went out through the door: the turn's world loads next. */
  isOut = false
  /** He came home after a long idle, so he naps soon. */
  isNapping = false
  /** On his way out: a start if he was dozing, the sprint to the door, through it. */
  leaving: Leaving | null = null
  room: Room = 'hall'

  private items: HubItem[] = []
  private newItem: { at: number; item: HubItem } | null = null
  private labels: Label[] = [] // the keepsakes' titles, drawn over the figure
  private doorOpenUntil = 0
  private pastime: Doing | null = null
  private lastPastime: Pastime | null = null
  private requested: Pastime | null = null
  private pastimeAt = -1 // when the next may start; -1: a few seconds after the first step at home
  private trip: { to: Room; dir: Facing } | null = null
  private flowers: { stage: number; color: number }[] = []

  constructor(private readonly stage: StageHost) {}

  /** How the room he is in looks. */
  get look(): Look {
    return ROOM_LOOK[this.room]
  }

  /** At home with the hub his to roam: not on his way out, not out of the door. */
  get isRoaming(): boolean {
    return this.isHere && !this.isOut
  }

  /** On the move or at a pastime: too busy to doze off. */
  get isBusy(): boolean {
    return this.leaving !== null || this.pastime !== null || this.trip !== null
  }

  /** The room he is in and what he does there (`hall:admire`), null away from home. */
  get doing(): string | null {
    return this.isHere ? `${this.room}:${this.trip ? 'walking' : this.pastime?.kind ?? 'idle'}` : null
  }

  /** Settled into `kind`, there and at it. */
  isDoing(kind: Pastime): boolean {
    return this.isHere && this.pastime?.kind === kind && this.pastime.phase === 'do'
  }

  get isResting(): boolean {
    return this.isDoing('rest')
  }

  get isWatching(): boolean {
    return this.isDoing('movie')
  }

  get isTending(): boolean {
    return this.isDoing('tend')
  }

  /** Sprinting for the door, arms out like a run. */
  get isSprinting(): boolean {
    return this.leaving?.isSprint === true && this.leaving.phase === 'walk'
  }

  /** The pastime he takes up next, whatever the dice say. */
  request(kind: Pastime) {
    this.requested = kind
  }

  /** The keepsakes on show, oldest first. */
  setItems(items: readonly HubItem[]) {
    this.items = [...items]
  }

  /** A new keepsake: if he is home it pops in with a sparkle, its title bright for a while, and he goes to see it. */
  addItem(item: HubItem) {
    this.items = [...this.items, item]
    if (!this.isHere) return
    const s = this.stage
    this.newItem = { at: s.now, item }
    this.requested = 'admire'
    const spot = this.keepsakes().find(k => k.item === item)
    for (let k = 0; k < 5; k++) s.give('sparkle', spot ? spot.col + 3 + Math.round(s.rand() * 4 - 2) : undefined)
  }

  /** The hub comes on stage, in the hall, nothing under way. */
  enter() {
    this.isHere = true
    this.isOut = false
    this.leaving = null
    this.isNapping = false
    this.room = 'hall'
    this.pastime = null
    this.trip = null
    this.pastimeAt = -1
  }

  /** The turn's world takes the stage. */
  exit() {
    this.isHere = false
    this.isOut = false
  }

  /** Where he stands at the session's start: beside the door. */
  get startCol(): number {
    return clamp(this.doorCol() - CLAUDE_WIDTH - 2, 0, this.stage.figure.maxX)
  }

  /** Back home through the door: it swings open and he steps out of it, to nap there soon. */
  arrive() {
    const { figure, now } = this.stage
    figure.x = this.doorSpot()
    figure.facing = -1
    this.doorOpenUntil = now + 900
    this.isNapping = true
    this.requested = 'rest'
  }

  /** He drops whatever he was doing and makes for the door; woken from a nap, with a start first. */
  leave(isWaking: boolean) {
    const { figure, now } = this.stage
    this.pastime = null
    this.trip = null
    figure.lift = 0
    figure.strollTo = null
    this.leaving = { phase: isWaking ? 'wake' : 'walk', at: now, isSprint: true }
  }

  /** On the way out: the start, the sprint to the door, the door opening, through it. */
  stepLeaving(dt: number) {
    const s = this.stage
    const { figure, now } = s
    const l = this.leaving!
    const next = (phase: Leaving['phase']) => {
      this.leaving = { ...l, phase, at: now }
    }
    if (l.phase === 'wake') {
      // a start: a little jump, eyes wide, then off
      const t = (now - l.at) / 1000
      figure.lift = t < 0.35 ? Math.sin((Math.PI * t) / 0.35) * 2 : 0
      if (t >= 0.6) next('walk')
    } else if (l.phase === 'walk') {
      const isThere = figure.walk(this.doorSpot(), dt, l.isSprint ? s.pace.walk * RUN_FACTOR : s.pace.walk)
      if (l.isSprint && !isThere && s.rand() < 12 * dt) s.give('dust')
      if (isThere) {
        figure.facing = 1
        next('open')
      }
    } else if (l.phase === 'open' && now - l.at >= 500) {
      figure.hidden = true
      next('in')
    } else if (l.phase === 'in' && now - l.at >= 500) {
      this.leaving = null
      this.isOut = true
    }
  }

  /** With nothing to play at home: a pastime, the walk to its room, or a pause between two. */
  step(dt: number) {
    const s = this.stage
    const { figure, now } = s
    figure.bob = 0
    if (this.trip) return this.stepTrip(dt)
    const p = this.pastime
    if (!p) {
      if (this.pastimeAt < 0) this.pastimeAt = now + 4000
      if (now < this.pastimeAt) return
      const kind = this.pickPastime()
      this.pastime = { kind, phase: 'go', until: 0, next: 0, flower: Math.floor(s.rand() * FLOWER_COUNT) }
      const room = PASTIMES[kind].room
      if (room !== this.room) this.trip = { to: room, dir: ROOMS.indexOf(room) > ROOMS.indexOf(this.room) ? 1 : -1 }
      return
    }
    if (p.phase === 'go') {
      const spot = this.pastimeSpot(p)
      if (spot === null) return this.endPastime() // no room for it at this width
      if (!figure.walk(spot, dt * HOME_PACE, s.pace.walk)) return
      const [lo, hi] = PASTIMES[p.kind].secs
      p.phase = 'do'
      p.until = now + (lo + s.rand() * (hi - lo)) * 1000
      p.next = now
      if (p.kind === 'movie' || p.kind === 'tend') figure.facing = 1
      return
    }
    if (now >= p.until) return this.endPastime()
    switch (p.kind) {
      case 'admire': return this.admire(dt)
      case 'tend': return this.tend(p, dt)
      case 'movie':
        // now and then the film gets a reaction
        if (now >= p.next) {
          p.next = now + 7000 + s.rand() * 7000
          if (p.next > now + 7500) s.react(['!', '?', '♪', '♥'][Math.floor(s.rand() * 4)]!, 1400)
        }
        return
      case 'rest':
        return
    }
  }

  private endPastime() {
    const s = this.stage
    const p = this.pastime
    if (p?.kind === 'tend') this.flowerTended(p.flower)
    this.lastPastime = p?.kind ?? null
    this.pastime = null
    s.figure.lift = 0
    this.pastimeAt = s.now + 3000 + s.rand() * 5000
  }

  /** The requested pastime, else one at random by weight: never the last one again, nor admiring an empty hall. */
  private pickPastime(): Pastime {
    const requested = this.requested
    this.requested = null
    if (requested) return requested
    const options = (Object.keys(PASTIMES) as Pastime[]).filter(k => k !== this.lastPastime && (k !== 'admire' || this.items.length))
    const total = options.reduce((sum, k) => sum + PASTIMES[k].weight, 0)
    let r = this.stage.rand() * total
    for (const k of options) if ((r -= PASTIMES[k].weight) < 0) return k
    return options[0] ?? 'tend'
  }

  /** Out one side of the room and in from the other side of the next, until he is where the pastime is. */
  private stepTrip(dt: number) {
    const s = this.stage
    const { figure } = s
    const t = this.trip!
    if (this.room === t.to) {
      this.trip = null // in from the edge: the pastime's own walk takes him to its spot
      return
    }
    figure.facing = t.dir
    figure.moving = true
    figure.x += t.dir * s.pace.walk * HOME_PACE * dt
    const isOut = t.dir > 0 ? figure.x >= s.columns + 1 : figure.x <= -CLAUDE_WIDTH - 1
    if (!isOut) return
    this.room = ROOMS[ROOMS.indexOf(this.room) + t.dir]!
    figure.x = t.dir > 0 ? -CLAUDE_WIDTH : s.columns
  }

  /** Where he stands for a pastime in its room, or null when the room has no space for it. */
  private pastimeSpot(p: { kind: Pastime; flower: number }): number | null {
    const { figure } = this.stage
    const den = this.denLayout()
    switch (p.kind) {
      case 'admire': return figure.within(figure.x)
      case 'tend': return this.flowerSpot(p.flower)
      case 'movie': return den.tv === null ? null : den.couch + 3
      case 'rest': return den.bed === null ? null : den.bed + BED_HEAD_X
    }
  }

  /** At the keepsakes: strolls from one to another, the title up as he stands by it. */
  private admire(dt: number) {
    const s = this.stage
    const { figure, now } = s
    if (figure.strollTo !== null) {
      if (figure.walk(figure.strollTo, dt * HOME_PACE, s.pace.walk)) figure.strollTo = null
      return
    }
    if (now < figure.strollAt) return
    figure.strollAt = now + 3000 + s.rand() * 4000
    const spots = this.keepsakes()
    if (!spots.length) return
    const k = spots[Math.floor(s.rand() * spots.length)]!
    figure.strollTo = figure.within(k.col + 3 - Math.floor(CLAUDE_WIDTH / 2) + (s.rand() < 0.5 ? -9 : 9))
  }

  /** In the garden: kneels by a flower with the can, a few drops falling, then on to the next. */
  private tend(p: { next: number; flower: number }, dt: number) {
    const s = this.stage
    const { figure, now } = s
    const at = this.flowerSpot(p.flower)
    if (at !== null && Math.abs(figure.x - at) > 0.5) {
      figure.walk(at, dt * HOME_PACE, s.pace.walk)
      p.next = now
      return
    }
    figure.facing = 1
    figure.bob = Math.floor(now / 700) % 2
    if (s.rand() < 9 * dt) {
      const spout = Math.round(figure.x) + CLAUDE_WIDTH + 3
      const top = figure.top ?? s.rows * 2 - 9
      s.fling({ x: spout, y: top + 3, vx: 1 + s.rand(), vy: 1, until: now + 500, color: P.sky })
    }
    if (now - p.next >= WATER_SECS * 1000) {
      // this one is watered: it grows a stage; on to another
      this.flowerTended(p.flower)
      let next = Math.floor(s.rand() * FLOWER_COUNT)
      if (next === p.flower) next = (next + 1) % FLOWER_COUNT
      p.flower = this.flowerCol(next) === null ? 0 : next
      p.next = now
    }
  }

  private flowerTended(i: number) {
    const { rand } = this.stage
    this.ensureFlowers()
    const f = this.flowers[i]
    if (!f) return
    if (f.stage < FLOWER_STAGES.length - 1) f.stage++
    else if (rand() < 0.25) {
      // a bloom that has had its day is picked, and a new seed goes in
      f.stage = 0
      f.color = Math.floor(rand() * FLOWER_COLORS.length)
    }
  }

  private ensureFlowers() {
    const { rand } = this.stage
    while (this.flowers.length < FLOWER_COUNT) {
      this.flowers.push({ stage: Math.floor(rand() * FLOWER_STAGES.length), color: Math.floor(rand() * FLOWER_COLORS.length) })
    }
  }

  // ---- the layout, by the band's width ----

  private doorCol(): number {
    const { columns } = this.stage
    return clamp(Math.round(columns * 0.8) - DOOR_WIDTH, 0, Math.max(0, columns - DOOR_WIDTH - 1))
  }

  /** Where he stands to go through the door, or after stepping out of it. */
  private doorSpot(): number {
    return this.stage.figure.within(this.doorCol() + Math.floor((DOOR_WIDTH - CLAUDE_WIDTH) / 2))
  }

  /** The keepsakes that fit left of the door, the newest kept, laid out oldest first. */
  private keepsakes(): { item: HubItem; col: number }[] {
    const step = KEEPSAKE_WIDTH + KEEPSAKE_GAP
    const fit = Math.max(0, Math.floor((this.doorCol() - 6) / step))
    if (fit === 0) return []
    return this.items.slice(-fit).map((item, i) => ({ item, col: 3 + i * step }))
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
    return col + FLOWER_WIDTH <= this.doorCol() - 2 ? col : null
  }

  /** Where he kneels to water flower `i`: just left of it. */
  private flowerSpot(i: number): number | null {
    const col = this.flowerCol(i)
    return col === null ? null : this.stage.figure.within(col - CLAUDE_WIDTH + 1)
  }

  // ---- drawing ----

  /** The room behind him: the garden's flowers, the den's furniture or the hall's keepsakes, and the door. */
  draw(c: Canvas, ground: number) {
    this.labels = []
    if (this.room === 'garden') this.drawGarden(c, ground)
    if (this.room === 'den') this.drawDen(c, ground)
    if (this.room === 'hall') this.drawHall(c, ground)
    this.drawDoor(c, ground)
  }

  /** The keepsakes' titles, over the figure. */
  drawLabels(c: Canvas) {
    for (const l of this.labels) {
      // clear sky behind each title, so a drifting mote never shows through as a block
      for (let k = 0; k < cellWidth(l.text); k++) {
        c.set(l.col + k, l.row * 2, DEFAULT)
        c.set(l.col + k, l.row * 2 + 1, DEFAULT)
      }
      c.text(l.col, l.row, l.text, l.color)
    }
  }

  /** Him lying in bed, tucked in under the blanket, his nightcap on; answers the sprite's top row. */
  drawInBed(c: Canvas, ground: number, isAwake: boolean): number {
    const lying = claudeLying(isAwake ? 'open' : 'shut')
    const bed = this.denLayout().bed ?? 2
    const top = ground - 2 - lying.length
    c.sprite(bed + BED_HEAD_X, top, lying, TINTS.normal)
    c.sprite(bed + BED_HEAD_X + 1, top - 1, SLEEP_CAP.rows, SLEEP_CAP.palette)
    c.sprite(bed, ground - BED_OVER.rows.length, BED_OVER.rows, BED_OVER.palette)
    return top
  }

  /** How many pixels up he sits now: on the couch, his legs behind its front. */
  get seatLift(): number {
    return this.isWatching ? SIT_LIFT : 0
  }

  /** What goes in front of him: the couch's seat as he watches, the can in his hand as he waters. */
  drawInFront(c: Canvas, ground: number, figureLeft: number, figureTop: number) {
    if (this.isWatching) c.sprite(this.denLayout().couch, ground - COUCH_FRONT.rows.length, COUCH_FRONT.rows, COUCH_FRONT.palette)
    if (this.isTending) c.sprite(figureLeft + CLAUDE_WIDTH - 1, figureTop + 2 + this.stage.figure.bob, WATERING_CAN.rows, WATERING_CAN.palette)
  }

  /** The hall: his keepsakes left of the door, every title up, dim; the one he stands by (or a new one) bright. */
  private drawHall(c: Canvas, ground: number) {
    const { figure, columns, now } = this.stage
    const near = figure.x + CLAUDE_WIDTH / 2
    const fresh = this.newItem && now - this.newItem.at <= NEW_ITEM_MS ? this.newItem.item : null
    const titles: { text: string; center: number; row: number; color: number; rank: number; order: number }[] = []
    for (const { item, col } of this.keepsakes()) {
      const art = HUB_ART[item.kind]
      const top = ground - art.rows.length
      c.sprite(col, top, art.rows, art.palette)
      const center = col + Math.floor(art.rows[0]!.length / 2)
      const isNew = fresh === item
      const isNear = !figure.hidden && Math.abs(near - center) <= 10 && !figure.moving
      titles.push({
        text: item.label, center, row: Math.max(0, Math.floor(top / 2) - 1),
        color: isNew ? P.yellow : isNear ? P.silver : P.steel, rank: isNew ? 0 : isNear ? 1 : 2, order: titles.length,
      })
    }
    // the brightest are placed first; neighbours step up a row rather than run into each other
    const taken: [number, number, number][] = [] // row, left, right
    for (const t of [...titles].sort((a, b) => a.rank - b.rank)) {
      const width = cellWidth(t.text)
      const left = clamp(t.center - Math.floor(width / 2), 0, Math.max(0, columns - width))
      const rows = t.order % 2 ? [t.row - 1, t.row] : [t.row, t.row - 1]
      const row = rows.find(r => r >= 0 && taken.every(([tr, l, r2]) => tr !== r || left + width + 1 <= l || r2 + 1 <= left))
      if (row === undefined) continue
      taken.push([row, left, left + width])
      this.labels.push({ col: left, row, text: t.text, color: t.color })
    }
  }

  private drawDoor(c: Canvas, ground: number) {
    const isOpen = this.stage.now < this.doorOpenUntil || this.leaving?.phase === 'open' || this.leaving?.phase === 'in'
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
      last = col + FLOWER_WIDTH
      const rows = FLOWER_STAGES[f.stage]!
      const [petal, shade] = FLOWER_COLORS[f.color]!
      c.sprite(col, ground - rows.length, rows, flowerPalette(petal, shade))
    })
    for (let x = first - 1; x <= last; x++) c.set(x, ground, P.bark)
  }

  /** The den: the bed, the couch's back and the TV, its screen playing while he watches. */
  private drawDen(c: Canvas, ground: number) {
    const { now } = this.stage
    const { bed, couch, tv } = this.denLayout()
    if (bed !== null) c.sprite(bed, ground - BED.rows.length, BED.rows, BED.palette)
    c.sprite(couch, ground - COUCH_BACK.rows.length, COUCH_BACK.rows, COUCH_BACK.palette)
    if (tv === null) return
    const top = ground - TV.rows.length
    c.sprite(tv, top, TV.rows, TV.palette)
    if (!this.isWatching) return
    // the film: a sky and a ground that change with each cut, a figure crossing
    const cut = Math.floor(now / 2600)
    const skies = [P.sky, P.navy, P.plum, P.amber, P.slate]
    const grounds = [P.leaf, P.moss, P.sand, P.steel, P.wood]
    const s = TV_SCREEN
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        c.set(tv + s.x + x, top + s.y + y, y < Math.ceil(s.h / 2) ? skies[cut % skies.length]! : grounds[(cut * 3) % grounds.length]!)
      }
    }
    const walker = Math.floor((now % 2600) / (2600 / s.w))
    c.set(tv + s.x + walker, top + s.y + Math.ceil(s.h / 2) - 1, P.white)
  }
}
