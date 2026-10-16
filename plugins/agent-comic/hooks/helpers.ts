// Helpers: each subagent at work is a small Claude. It walks in from the far edge with its task as
// a label, acts out the subagent's tool calls (reading, digging, typing), keeps out of Claude's
// way, and once its subagent is done walks over to Claude to report, then vanishes in a puff.

import type { Canvas } from './canvas'
import { cellText, cellWidth } from './canvas'
import type { Facing, StageHost } from './figure'
import { BITS, CLAUDE_WIDTH, MINI_HEIGHT, MINI_WIDTH, P, TINTS, miniClaude } from './sprites'
import { clamp } from './util'

const MAX_HELPERS = 3 // small Claudes on stage at once
const LABEL_MS = 4000 // its task shows for its first few seconds on stage
const REPORT_MS = 700 // the hop beside Claude as it hands over what it found

type Helper = {
  /** The id it was started with: the main thread's tool_use_id, or `agent:<agentId>`. */
  id: string
  /** The subagent it acts for, once one of its tool calls named it. */
  agentId?: string
  label: string
  x: number
  facing: Facing
  /** Where it is walking to, if anywhere. */
  target: number | null
  state: 'arriving' | 'working' | 'leaving' | 'reporting' | 'gone'
  activity: 'read' | 'type' | 'dig' | null
  activityUntil: number
  born: number
  lastActive: number
  /** It works on in the background: it leaves on its own once it falls quiet. */
  isBackground: boolean
  reportAt: number
  moving: boolean
}

export class Helpers {
  private list: Helper[] = []

  constructor(private readonly stage: StageHost) {}

  /** How many small Claudes are on stage. */
  get count(): number {
    return this.list.length
  }

  /** A subagent was started: a small Claude walks in from the far edge with its task as a label. */
  start(id: string, label: string, isBackground = false) {
    const s = this.stage
    if (this.list.length >= MAX_HELPERS || this.list.some(h => h.id === id)) return
    const fromRight = s.figure.x < s.columns / 2
    this.list.push({
      id, label: cellText(label), isBackground,
      x: fromRight ? s.columns : -MINI_WIDTH,
      facing: fromRight ? -1 : 1,
      target: this.freeSpot(),
      state: 'arriving', activity: null, activityUntil: 0,
      born: s.now, lastActive: s.now, reportAt: 0, moving: false,
    })
  }

  /** A tool call inside a subagent: its small Claude acts it out for a moment. */
  activity(agentId: string, tool: string) {
    const now = this.stage.now
    let h = this.list.find(h => h.agentId === agentId) ?? this.list.find(h => !h.agentId && h.state !== 'leaving')
    if (!h) {
      // a subagent never seen to start (it began before a reload, or in the background): it walks in now
      this.start(`agent:${agentId}`, '', true)
      h = this.list.find(h => h.id === `agent:${agentId}`)
      if (!h) return
    }
    h.agentId = agentId
    h.activity = /^(Read|WebFetch|NotebookRead)$/.test(tool) ? 'read' : /^(Grep|Glob|WebSearch)$/.test(tool) ? 'dig' : 'type'
    h.activityUntil = now + 1600
    h.lastActive = now
  }

  /** A subagent that went on in the background: its small Claude stays until it falls quiet. */
  background(id: string) {
    const h = this.list.find(h => h.id === id)
    if (h) h.isBackground = true
  }

  /** A subagent finished (its tool call returned): its small Claude goes to report. */
  done(id: string) {
    this.leave(this.list.find(h => h.id === id))
  }

  /** A subagent finished (its stop event): the small Claude acting for it goes to report. */
  doneByAgent(agentId: string) {
    this.leave(this.list.find(h => h.agentId === agentId))
  }

  private leave(h: Helper | undefined) {
    if (h && h.state !== 'reporting') h.state = 'leaving'
  }

  /** A free-ish spot for a helper: away from Claude and from the other helpers. */
  private freeSpot(): number {
    const { figure, columns, rand } = this.stage
    const span = Math.max(1, columns - MINI_WIDTH)
    for (let k = 0; k < 12; k++) {
      const x = Math.floor(rand() * span)
      const clearOfClaude = x + MINI_WIDTH * 3 + 3 < figure.x || x > figure.x + CLAUDE_WIDTH + MINI_WIDTH * 2 + 3
      const clearOfOthers = this.list.every(h => Math.abs((h.target ?? h.x) - x) > MINI_WIDTH + 2)
      if (clearOfClaude && clearOfOthers) return x
    }
    return Math.floor(rand() * span)
  }

  /** Moves every helper on by `dt` seconds; a digging one throws up dirt of `dirtColor`. */
  step(dt: number, dirtColor: number) {
    const s = this.stage
    const { now, rand } = s
    const claudeX = s.figure.x
    const toward = (h: Helper, target: number, speed: number) => {
      const d = target - h.x
      h.moving = Math.abs(d) >= 0.5
      if (!h.moving) return true
      h.facing = d > 0 ? 1 : -1
      h.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt)
      return false
    }
    // keeps out of Claude's way, and of anyone reporting to him
    const nearClaude = (x: number) => x + MINI_WIDTH + 3 > claudeX - MINI_WIDTH * 2 && x < claudeX + CLAUDE_WIDTH + MINI_WIDTH * 2 + 3
    for (const h of this.list) {
      h.moving = false
      switch (h.state) {
        case 'arriving':
          if (toward(h, h.target ?? h.x, s.pace.walk * 0.8)) h.state = 'working'
          break
        case 'working': {
          if (h.target !== null && toward(h, h.target, s.pace.walk * 0.5)) h.target = null
          if (h.target === null && nearClaude(h.x)) h.target = this.freeSpot()
          // between tool calls it potters about a little
          if (h.target === null && now > h.activityUntil && rand() < 0.25 * dt) {
            const next = clamp(h.x + (rand() * 12 - 6), 0, s.columns - MINI_WIDTH)
            if (!nearClaude(next)) h.target = next
          }
          if (h.activity === 'dig' && now < h.activityUntil && rand() < 4 * dt) {
            const front = h.facing > 0 ? h.x + MINI_WIDTH : h.x - 1
            s.fling({ x: front, y: s.rows * 2 - 3, vx: -h.facing * 8, vy: -14, until: now + 500, color: dirtColor })
          }
          // a background helper with nothing more to do wanders off after a quiet spell
          if (h.isBackground && now - h.lastActive > 45_000 && now - h.born > 20_000) h.state = 'leaving'
          break
        }
        case 'leaving': {
          // to Claude's side, to hand over what it found, queueing behind helpers already there
          const isLeft = h.x < claudeX
          const ahead = this.list.filter(o =>
            o !== h && (o.state === 'reporting' || o.state === 'leaving') && o.x < claudeX === isLeft && Math.abs(o.x - claudeX) < Math.abs(h.x - claudeX)).length
          const step = (MINI_WIDTH + 1) * ahead
          const side = isLeft ? claudeX - MINI_WIDTH - 1 - step : claudeX + CLAUDE_WIDTH + 1 + step
          if (toward(h, side, s.pace.walk)) {
            h.state = 'reporting'
            h.reportAt = now
            h.facing = h.x < claudeX ? 1 : -1
          }
          break
        }
        case 'reporting':
          if (now - h.reportAt <= REPORT_MS) break
          s.give('poof', Math.round(h.x + MINI_WIDTH / 2) - 1, s.rows * 2 - 6)
          for (let k = 0; k < 2; k++) s.give('sparkle')
          h.state = 'gone'
          break
      }
    }
    this.list = this.list.filter(h => h.state !== 'gone')
  }

  draw(c: Canvas) {
    const { now, rows, columns } = this.stage
    const ground = rows * 2 - 2
    const labels: [number, number, number][] = [] // row, left, right of the labels already drawn
    for (const [index, h] of this.list.entries()) {
      const isWorking = h.state === 'working' && now < h.activityUntil
      const bob = isWorking && h.activity !== 'read' ? Math.floor(now / 180) % 2 : 0
      const hop = h.state === 'reporting' ? Math.round(Math.sin((Math.PI * (now - h.reportAt)) / REPORT_MS) * 2) : 0
      const art = miniClaude({ walk: h.moving ? Math.floor(now / 140) : 0, blink: now % 3900 < 130, left: h.facing < 0 })
      const left = Math.round(h.x)
      const top = ground - MINI_HEIGHT + bob - hop
      c.sprite(left, top, art, TINTS.normal)
      if (isWorking && h.activity === 'read') {
        c.sprite(h.facing > 0 ? left + 4 : left, top + 2, BITS.miniBook.rows, BITS.miniBook.palette)
      }
      if (!h.label || now - h.born >= LABEL_MS) continue
      // alternate rows so two arriving helpers' labels do not run into each other; skip one that still would
      const chars = [...h.label]
      const text = chars.length > 16 ? chars.slice(0, 15).join('') + '…' : h.label
      const width = cellWidth(text)
      const row = Math.max(0, Math.floor(top / 2) - 1 - (index % 2))
      const l = clamp(left + 3 - Math.floor(width / 2), 0, Math.max(0, columns - width))
      const r = l + width
      if (labels.every(([lr, ll, rr]) => lr !== row || r + 1 <= ll || rr + 1 <= l)) {
        c.text(l, row, text, P.mist)
        labels.push([row, l, r])
      }
    }
  }
}
