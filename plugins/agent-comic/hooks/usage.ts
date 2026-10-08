// What the director's Sonnet calls cost, in tokens: per session and per day.

import type { ModelUsage } from 'claude-code'

export type Tally = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }

export const emptyTally = (): Tally => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

/** Adds one call's usage to a tally (a new one; the old is left as it was). */
export function addUsage(t: Tally, u: ModelUsage): Tally {
  return {
    calls: t.calls + 1,
    input: t.input + u.input_tokens,
    output: t.output + u.output_tokens,
    cacheRead: t.cacheRead + u.cache_read_input_tokens,
    cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
  }
}

/** Reads a stored tally back, tolerating anything missing or malformed. */
export function asTally(v: unknown): Tally {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  const n = (k: keyof Tally) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : 0)
  return { calls: n('calls'), input: n('input'), output: n('output'), cacheRead: n('cacheRead'), cacheWrite: n('cacheWrite') }
}

/** Today's date as YYYY-MM-DD in local time: the key the daily tally is stored under. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function formatStats(model: string, session: Tally, day: Tally, dayKey: string): string {
  const row = (label: string, t: Tally) =>
    `| ${label} | ${t.calls} | ${fmt(t.input)} | ${fmt(t.output)} | ${fmt(t.cacheRead)} | ${fmt(t.cacheWrite)} |`
  return [
    `Agent comic director (model: ${model}): tokens spent on staging scenes.`,
    '',
    '| | calls | input | output | cache read | cache write |',
    '|---|---|---|---|---|---|',
    row('this session', session),
    row(`today (${dayKey})`, day),
    '',
    'Idle time costs nothing: scenes are only requested while Claude works.',
  ].join('\n')
}
