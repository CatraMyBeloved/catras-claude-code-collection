// A pat for Claude (the ♥ beside the band, or /comic-pet): hearts at once, and a headpat sent as the
// person's own message, which Claude answers. While he answers it the comic stays as it is.

import type { EngineInterface } from 'claude-code'

import { stage } from './runtime'

const LINES = [
  'Here, have a headpat. You are doing amazing!',
  '*pats your head* You are doing great, Claude.',
  'Headpat delivery! Thanks for all the help today.',
  'Here is a little headpat. Keep it up!',
  '*gentle headpat* Proud of you.',
  'Have a headpat, you have earned it!',
  'Headpat break! You are doing wonderfully.',
  '*pat pat* Great work so far.',
]

class Pats {
  /** Claude is answering a pat: no world is set up for it, no scenes are staged. */
  isAnswering = false
  private pending: string[] = [] // headpats sent, their turns not begun yet
  private lastLine = -1

  /** The next pat's message, never the same one twice running; its turn is told apart by it. */
  send(): string {
    let i = Math.floor(Math.random() * LINES.length)
    if (i === this.lastLine) i = (i + 1) % LINES.length
    this.lastLine = i
    this.pending.push(LINES[i]!)
    return LINES[i]!
  }

  /** True when a turn beginning with `text` answers one of the pats sent (it is crossed off). */
  claim(text: string): boolean {
    const i = this.pending.indexOf(text)
    if (i < 0) return false
    this.pending.splice(i, 1)
    return true
  }
}

export const pats = new Pats()

/**
 * A pat: hearts at once, and the headpat sent as the person's message. Sent from a timer, once the hook
 * that asked has returned: a prompt made inside a command would wait on the turn the command holds.
 */
export function givePat($: EngineInterface) {
  stage.pet()
  const text = pats.send()
  $.clock.after(0, () => $.prompt.submit({ text, asUser: true }).catch(() => undefined))
}
