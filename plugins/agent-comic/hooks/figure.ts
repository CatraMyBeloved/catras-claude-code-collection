// The Claude figure's body: where he stands, which way he faces, how he holds himself this moment,
// and the walk that moves him. The stage, the hub and the helpers all move him through it.

import type { Pace } from './beats'
import type { EffectKind, Particle } from './effects'
import { CLAUDE_HEIGHT, CLAUDE_WIDTH } from './sprites'
import { clamp } from './util'

export type Facing = 1 | -1

export class Figure {
  /** His left column; fractional while he walks. */
  x = 4
  facing: Facing = 1
  /** Pixels off the ground: a hop, a jump, a start. */
  lift = 0
  /** 1 while he dips for a moment: a shovel stroke, a hammer blow, a keystroke, a watering. */
  bob = 0
  /** Eyes turned aside, at something. */
  looking = false
  /** He moved this step, so his legs walk. */
  moving = false
  /** Out of sight, through a door. */
  hidden = false
  /** The sprite's top pixel row as last drawn, for whatever goes over his head. */
  top: number | null = null
  /** An idle stroll: where to, and when the next may begin. */
  strollTo: number | null = null
  strollAt = 0
  /** The band's width, in columns. */
  columns = 80

  /** The furthest column right he can stand at. */
  get maxX(): number {
    return Math.max(0, this.columns - CLAUDE_WIDTH)
  }

  /** `col` held to where he can stand. */
  within(col: number): number {
    return clamp(col, 0, this.maxX)
  }

  /** Moves toward `target` at `speed` columns a second; true once there. */
  walk(target: number, dt: number, speed: number): boolean {
    target = this.within(target)
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

  /** Both feet on the ground, eyes ahead. */
  settle() {
    this.lift = 0
    this.bob = 0
    this.looking = false
  }

  /** His head's top pixel row on a band `rows` tall: as last drawn, else where it would be. */
  headTop(rows: number): number {
    return this.top ?? rows * 2 - 2 - CLAUDE_HEIGHT - Math.round(this.lift)
  }
}

/** What the hub and the helpers need of the stage they play on. */
export interface StageHost {
  readonly figure: Figure
  readonly rand: () => number
  /** The stage's clock (ms). */
  readonly now: number
  readonly columns: number
  readonly rows: number
  readonly pace: Pace
  /** Starts an effect near Claude's head, or at a given pixel. */
  give(kind: EffectKind, x?: number, y?: number): void
  /** Sends a particle flying: a clod of dirt, a drop of water. */
  fling(particle: Particle): void
  /** A mark over Claude's head for `ms`: "!", "?", a note. */
  react(glyph: string, ms: number): void
}
