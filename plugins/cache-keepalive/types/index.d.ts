export type Ttl = '5m' | '1h'

/** One main-thread request or keep-alive, as the pane's timeline draws it. */
export type CacheEvent = 'hit' | 'miss' | 'ping'

export type CacheClock = {
  /** When the last request that read or wrote the main cache started (clock ms). */
  refreshedAt: number | null
  /** When the person last prompted (clock ms). */
  activeAt: number | null
  /** Keep-alives sent since the person last prompted. */
  pings: number
  /** Paused with /keepalive off. */
  isPaused: boolean
  /** What the last keep-alive came to, for /keepalive. */
  lastPing: string | null
  /** Tokens the last main-thread request read from or wrote to the cache: the warm prefix. */
  cachedTokens: number
  /** The last requests and keep-alives, oldest first, at most 40. */
  history: CacheEvent[]
}

declare module 'claude-code' {
  interface PluginState {
    'cache-keepalive': { clock: CacheClock }
  }
}
