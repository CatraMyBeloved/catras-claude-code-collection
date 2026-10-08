import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheEvent, Ttl } from '../types'
import type { Verdict } from './keepalive'
import {
  ACK_PROMPT,
  CALM,
  TTL_MS,
  bar,
  decide,
  emptyClock,
  formatLeft,
  formatTokens,
  gaugeColor,
  resolveTtl,
  statusText,
  withEvent,
} from './keepalive'

const PLUGIN = 'cache-keepalive'
const PANE = 'cache-keepalive'
const clock = atom({ plugin: 'cache-keepalive', key: 'clock' } as const, emptyClock)

type Mode = 'prompt' | 'off'

/** A queued acknowledgement prompt holds further asks this long while its turn gets going. */
const ASK_HOLD_MS = 60_000

/** Per load: what a reload loses here is re-learned from the next request. */
type Live = {
  mode: Mode
  leadMs: number
  maxIdleMs: number
  configuredTtl: string
  requests: number
  isTurnRunning: boolean
  isPinging: boolean
  /** When the last prompt keep-alive was queued; its turn's request has not landed yet. */
  askedAt: number | null
  isCachingOff: boolean
  ttlSources: { force5m?: string; envTtl?: string; settingsTtl?: unknown; enable1h?: string }
}

const EVENT_LOOK: Record<CacheEvent, { glyph: string; color: string }> = {
  hit: { glyph: '●', color: CALM.green },
  miss: { glyph: '●', color: CALM.red },
  ping: { glyph: '◆', color: CALM.blue },
}

async function currentTtl($: EngineInterface, live: Live): Promise<Ttl> {
  const { rateLimits } = await $.session.usage()
  return resolveTtl({ configured: live.configuredTtl, rateLimits, ...live.ttlSources })
}

async function ping($: EngineInterface, live: Live): Promise<void> {
  // Two ticks can both decide to ping before either starts: the second stands down.
  if (live.isPinging) return
  live.isPinging = true
  try {
    const startedAt = await $.clock.now()
    live.askedAt = startedAt
    await update($, clock, c => ({
      ...c,
      pings: c.pings + 1,
      lastPing: `${new Date(startedAt).toLocaleTimeString()}: asked Claude for an acknowledgement`,
      history: withEvent(c.history, 'ping'),
    }))
    // Its turn's request reads the cache and restarts the clock through the turn.step hook.
    await $.prompt.submit({ text: ACK_PROMPT })
  } finally {
    live.isPinging = false
  }
}

async function assess($: EngineInterface, live: Live): Promise<{ verdict: Verdict; ttl: Ttl }> {
  const [now, c, ttl] = await Promise.all([$.clock.now(), read($, clock), currentTtl($, live)])
  const verdict = decide({
    clock: c,
    now,
    ttlMs: TTL_MS[ttl],
    // A lead as long as the lifetime would ping right after every request, the acknowledgement's own included.
    leadMs: Math.min(live.leadMs, TTL_MS[ttl] / 2),
    maxIdleMs: live.maxIdleMs,
    isRequesting: live.requests > 0,
    isTurnRunning: live.isTurnRunning,
    mode: live.mode,
    isPinging: live.isPinging || (live.askedAt !== null && now - live.askedAt < ASK_HOLD_MS),
  })
  return { verdict, ttl }
}

async function tick($: EngineInterface, live: Live): Promise<void> {
  if (live.isCachingOff) return
  const { verdict } = await assess($, live)
  // The footer bar and the pane read the clock, not state: redraw them each second.
  $.ui.invalidate('ui.render')
  if (verdict.kind === 'ping') await ping($, live)
}

async function statusLines($: EngineInterface, live: Live): Promise<string> {
  const [now, c, ttl] = await Promise.all([$.clock.now(), read($, clock), currentTtl($, live)])
  const left = c.refreshedAt === null ? null : c.refreshedAt + TTL_MS[ttl] - now
  const lines = [
    live.isCachingOff ? 'Prompt caching is disabled (DISABLE_PROMPT_CACHING).' : null,
    `TTL: ${ttl}${live.configuredTtl === 'auto' ? ' (auto)' : ''} · keep-alive: ${live.mode === 'off' ? 'off' : 'prompt'} · lead: ${live.leadMs / 1000}s`,
    left === null ? 'Cache: no request yet' : left > 0 ? `Cache: warm, ${formatLeft(left)} left` : 'Cache: cold',
    `Keep-alive: ${c.isPaused ? 'paused' : 'on'} · ${c.pings} ping(s) since your last prompt`,
    c.lastPing ? `Last ping: ${c.lastPing}` : null,
  ]
  return lines.filter(Boolean).join('\n')
}

export const register: Register = (on, options) => {
  const live: Live = {
    mode: options.mode === 'off' ? 'off' : 'prompt',
    leadMs: Math.max(5, Number(options.leadSeconds) || 20) * 1000,
    maxIdleMs: Math.max(0, Number(options.maxIdleMinutes) || 0) * 60_000,
    configuredTtl: String(options.ttl ?? 'auto'),
    requests: 0,
    isTurnRunning: false,
    isPinging: false,
    askedAt: null,
    isCachingOff: false,
    ttlSources: {},
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Headless runs (claude -p) only for testing the mod itself.
    if (!e.isInteractive && (await $.env.get('CACHE_KEEPALIVE_HEADLESS')) !== '1') return result

    const [force5m, envTtl, enable1h, disabled, settings] = await Promise.all([
      $.env.get('FORCE_PROMPT_CACHING_5M'),
      $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
      $.env.get('ENABLE_PROMPT_CACHING_1H'),
      $.env.get('DISABLE_PROMPT_CACHING'),
      $.settings.read(),
    ])
    live.ttlSources = { force5m, envTtl, enable1h, settingsTtl: (settings as Record<string, unknown>).promptCacheTtl }
    live.isCachingOff = disabled !== undefined && disabled !== '' && disabled !== '0'
    // State outlives a reload: give a value an older version wrote the fields this one added.
    // An activity time from the start, so the idle cutoff holds even if the person never prompts.
    const startedAt = await $.clock.now()
    await update($, clock, c => ({ ...emptyClock, ...c, activeAt: c.activeAt ?? startedAt }))
    // The engine draws plugin status lines in its own color; the bar lives in the footer instead.
    $.ui.status(undefined)

    await $.command.register({
      name: 'keepalive',
      description: 'Prompt cache keep-alive: open the gauge, or status, on, off, now',
      argumentHint: '[status|on|off|now]',
    })
    $.clock.every(1000, () => {
      tick($, live).catch(err => $.ui.log(`keep-alive tick failed: ${String(err)}`, { to: 'debug' }))
    })

    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, clock, c => ({ ...emptyClock, isPaused: c.isPaused }))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isOurs = e.origin.kind === 'plugin' && e.origin.name === PLUGIN
    if (!isOurs) {
      const now = await $.clock.now()
      await update($, clock, c => ({ ...c, activeAt: now, pings: 0 }))
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    live.isTurnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) live.isTurnRunning = false
    return next(e)
  })

  // Every main-thread request reads and extends the cache: its start is when the lifetime restarts.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const startedAt = await $.clock.now()
    live.requests += 1
    live.askedAt = null
    try {
      const result = yield* next(e)
      const usage = result.usage
      if (usage !== null) {
        const { cache_read_input_tokens: hit, cache_creation_input_tokens: wrote } = usage
        const isCached = hit > 0 || wrote > 0
        await update($, clock, c => ({
          ...c,
          refreshedAt: isCached ? Math.max(c.refreshedAt ?? 0, startedAt) : null,
          cachedTokens: hit + wrote,
          // A request that mostly wrote found the prefix cold: a miss.
          history: withEvent(c.history, hit >= wrote ? 'hit' : 'miss'),
        }))
      }
      return result
    } finally {
      live.requests -= 1
    }
  })

  on('command.run', { command: 'keepalive' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, clock, c => ({ ...c, isPaused: arg === 'off' }))
      return { text: `Cache keep-alive ${arg === 'off' ? 'paused' : 'resumed'}.` }
    }
    if (arg === 'now') {
      if (live.isPinging) return { text: 'A keep-alive is already running.' }
      await ping($, live)
      return { text: `Keep-alive sent. ${(await read($, clock)).lastPing ?? ''}`.trim() }
    }
    if (arg === 'status') return { text: await statusLines($, live) }

    const opened = await $.ui.open({ id: PANE, title: 'Prompt cache' })
    return { text: opened.isPlaced ? 'Prompt cache gauge opened.' : await statusLines($, live) }
  })

  // The mode labels at the right of the prompt footer: kept, with the cache bar beside them in a calm tone.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (live.isCachingOff) return next(e)
    const { verdict, ttl } = await assess($, live)
    const label = statusText(verdict, ttl)
    if (label === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const color = verdict.kind === 'cold' ? CALM.red : verdict.kind === 'unknown' ? CALM.green : gaugeColor(verdict.leftMs, TTL_MS[ttl])

    return (
      <Box flexDirection="row">
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} · </Text>}
        <Text color={color}>{label}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [now, c, ttl] = await Promise.all([$.clock.now(), read($, clock), currentTtl($, live)])
    const ttlMs = TTL_MS[ttl]
    const left = c.refreshedAt === null ? null : c.refreshedAt + ttlMs - now
    const width = Math.max(10, Math.min(60, (e.props.bodyColumns ?? 40) - 2))
    const color = gaugeColor(left ?? 0, ttlMs)
    const state = live.isCachingOff
      ? 'caching disabled'
      : left === null
        ? 'waiting for the first request'
        : left <= 0
          ? 'cold: the next request re-writes it'
          : `warm · ${formatLeft(left)} left`
    const expires = left !== null && left > 0 ? new Date(now + left).toLocaleTimeString() : null
    const keepalive = c.isPaused
      ? 'paused'
      : live.mode === 'off'
        ? 'off (timer only)'
        : `on · asks ${live.leadMs / 1000}s before expiry, once Claude is idle`

    return (
      <Box flexDirection="column">
        <Text bold>{state}</Text>
        <Text color={left !== null && left > 0 ? color : 'inactive'}>{bar(left ?? 0, ttlMs, width, '█', '░')}</Text>
        <Text dimColor>{`TTL ${ttl}${live.configuredTtl === 'auto' ? ' (auto)' : ''}${expires ? ` · expires ${expires}` : ''}`}</Text>
        <Text> </Text>
        <Text>
          cached prefix <Text bold>{formatTokens(c.cachedTokens)}</Text> tokens
        </Text>
        <Text>
          keep-alive <Text bold>{keepalive}</Text>
        </Text>
        <Text dimColor>{c.pings} ping(s) since your last prompt</Text>
        {c.lastPing && <Text dimColor wrap="truncate-end">last: {c.lastPing}</Text>}
        <Text> </Text>
        <Text dimColor>recent requests</Text>
        <Text>
          {c.history.length === 0 ? <Text dimColor>none yet</Text> : c.history.slice(-width).map(ev => (
            <Text color={EVENT_LOOK[ev].color}>{EVENT_LOOK[ev].glyph}</Text>
          ))}
        </Text>
        <Text dimColor>
          <Text color={CALM.green}>●</Text> hit  <Text color={CALM.red}>●</Text> miss  <Text color={CALM.blue}>◆</Text> keep-alive
        </Text>
        <Text> </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="now" hotkey="p" label="Ping now" onPress={() => void ping($, live)} />
          <Button
            key="pause"
            hotkey="k"
            label={c.isPaused ? 'Resume' : 'Pause'}
            onPress={() => update($, clock, s => ({ ...s, isPaused: !s.isPaused }))}
          />
        </Box>
      </Box>
    )
  })
}
