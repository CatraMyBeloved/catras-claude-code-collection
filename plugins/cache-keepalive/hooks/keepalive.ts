import type { CacheClock, CacheEvent, Ttl } from '../types'

export const TTL_MS: Record<Ttl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

export const ACK_PROMPT =
  '[cache keep-alive] Automated ping to keep the prompt cache warm. ' +
  'Respond with only a minimal acknowledgement (one word, e.g. "ok"). ' +
  'Do not use tools and do not continue any previous task.'

export const emptyClock: CacheClock = {
  refreshedAt: null,
  activeAt: null,
  pings: 0,
  isPaused: false,
  lastPing: null,
  cachedTokens: 0,
  history: [],
}

export const withEvent = (history: readonly CacheEvent[], event: CacheEvent): CacheEvent[] => [...history, event].slice(-40)

/** A bar of `width` cells, filled by the share of the lifetime left. */
export function bar(leftMs: number, ttlMs: number, width: number, full = '▰', empty = '▱'): string {
  const filled = Math.round(Math.min(1, Math.max(0, leftMs / ttlMs)) * width)
  return full.repeat(filled) + empty.repeat(width - filled)
}

/** Muted tones that read on dark and light themes alike: sage, sand, dusty rose, slate blue. */
export const CALM = { green: '#8DB596', yellow: '#D4BE84', red: '#C98C8C', blue: '#8FA8C2' } as const

/**
 * The gauge's tone by time left: green, then yellow for the last 10 minutes,
 * red for the last 3; a shorter lifetime keeps the same proportions of an hour.
 */
export function gaugeColor(leftMs: number, ttlMs: number): string {
  const scale = Math.min(1, ttlMs / TTL_MS['1h'])
  if (leftMs <= 3 * 60_000 * scale) return CALM.red
  if (leftMs <= 10 * 60_000 * scale) return CALM.yellow
  return CALM.green
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n)
}

export type TtlSources = {
  configured: string
  force5m?: string
  envTtl?: string
  settingsTtl?: unknown
  enable1h?: string
  /** The rate-limit windows the last response reported; empty off a subscription. */
  rateLimits: readonly { kind: string; percentUsed: number }[]
}

const isTtl = (v: unknown): v is Ttl => v === '5m' || v === '1h'
const isOn = (v?: string) => v !== undefined && v !== '' && v !== '0' && v !== 'false'

/** Claude Code's own precedence: FORCE_5M > env > setting > ENABLE_1H > default by account. */
export function resolveTtl(s: TtlSources): Ttl {
  if (isTtl(s.configured)) return s.configured
  if (isOn(s.force5m)) return '5m'
  if (isTtl(s.envTtl)) return s.envTtl
  if (isTtl(s.settingsTtl)) return s.settingsTtl
  if (isOn(s.enable1h)) return '1h'
  const plan = s.rateLimits.filter(r => r.kind === 'five_hour' || r.kind === 'seven_day')
  // A subscription gets 1h within plan usage; once it draws on credits (a window past 100) it drops to 5m.
  return plan.length > 0 && plan.every(r => r.percentUsed < 100) ? '1h' : '5m'
}

export type Situation = {
  clock: CacheClock
  now: number
  ttlMs: number
  leadMs: number
  maxIdleMs: number
  /** A main-thread request is in flight right now (it refreshes the cache itself). */
  isRequesting: boolean
  /** A turn is running; a keep-alive prompt would only queue behind it. */
  isTurnRunning: boolean
  mode: 'prompt' | 'off'
  isPinging: boolean
}

export type Verdict =
  | { kind: 'unknown' }
  | { kind: 'cold' }
  | { kind: 'warm'; leftMs: number; held?: 'paused' | 'idle' | 'off' }
  | { kind: 'ping'; leftMs: number }

export function decide(s: Situation): Verdict {
  if (s.clock.refreshedAt === null) return { kind: 'unknown' }
  const leftMs = s.clock.refreshedAt + s.ttlMs - s.now
  if (leftMs <= 0) return { kind: 'cold' }
  if (s.mode === 'off') return { kind: 'warm', leftMs, held: 'off' }
  if (s.clock.isPaused) return { kind: 'warm', leftMs, held: 'paused' }
  const isIdleTooLong =
    s.maxIdleMs > 0 && s.clock.activeAt !== null && s.now - s.clock.activeAt >= s.maxIdleMs
  if (isIdleTooLong) return { kind: 'warm', leftMs, held: 'idle' }
  // A prompt only queues behind a running turn, and the turn's own requests refresh the cache.
  const isBlocked = s.isPinging || s.isRequesting || s.isTurnRunning
  if (leftMs <= s.leadMs && !isBlocked) return { kind: 'ping', leftMs }

  return { kind: 'warm', leftMs }
}

export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')

  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function statusText(v: Verdict, ttl: Ttl): string | undefined {
  switch (v.kind) {
    case 'unknown':
      return undefined
    case 'cold':
      return `cache ${bar(0, 1, 8)} cold (${ttl})`
    case 'ping':
      return `cache ${bar(v.leftMs, TTL_MS[ttl], 8)} ${formatLeft(v.leftMs)} · refreshing…`
    case 'warm': {
      const held = v.held === 'idle' ? ' · idle, letting it lapse' : v.held === 'paused' ? ' · keep-alive off' : ''
      return `cache ${bar(v.leftMs, TTL_MS[ttl], 8)} ${formatLeft(v.leftMs)} (${ttl})${held}`
    }
  }
}
