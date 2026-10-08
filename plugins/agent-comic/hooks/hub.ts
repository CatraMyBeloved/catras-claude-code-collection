// The hub: Claude's own place, where the session opens. It keeps the keepsakes Claude
// adds with the comic's tool, across sessions, and has the door to each turn's world.

import { cellText } from './canvas'
import { HUB_KINDS } from './hubart'
import type { HubKind } from './hubart'

export type HubItem = { kind: HubKind; label: string; at: number }

export const MAX_HUB_ITEMS = 6 // the hub keeps the newest six; a seventh retires the oldest
export const MAX_HUB_LABEL = 16
export const HUB_STORE_KEY = 'hub'
export const HUB_TOOL = 'hub_add'

/** The tool Claude calls, as `$.tool.register` takes it: deferred, so it costs nothing until looked up. */
export const HUB_TOOL_SPEC = {
  name: HUB_TOOL,
  description:
    'Add a small keepsake to the agent-comic hub, the little home scene shown above the prompt when Claude Code starts. ' +
    'Use it rarely: only to remember a real milestone the person would be glad to see again (a hard bug finally fixed, ' +
    'a feature shipped, a long refactor done, tests green after a struggle). At most one per session; never for routine work.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...HUB_KINDS], description: 'trophy or medal for wins, plant or flower for growth, lantern for insight, banner for a release, gem for a rare find, statue for a big milestone' },
      label: { type: 'string', description: `What it remembers, at most ${MAX_HUB_LABEL} characters (e.g. "auth bug slain", "v2 shipped")` },
    },
    required: ['kind', 'label'],
    additionalProperties: false,
  },
  isDeferred: true,
} as const

/** A keepsake from the tool's input, or why not. */
export function hubItemFrom(input: unknown, at: number): HubItem | { error: string } {
  const i = (input ?? {}) as { kind?: unknown; label?: unknown }
  if (!HUB_KINDS.includes(i.kind as HubKind)) return { error: `kind must be one of: ${HUB_KINDS.join(', ')}` }
  const label = typeof i.label === 'string' ? [...cellText(i.label)].slice(0, MAX_HUB_LABEL).join('').trim() : ''
  if (!label) return { error: 'label must be a few words' }
  return { kind: i.kind as HubKind, label, at }
}

/** The stored keepsakes, read back safely: anything malformed is left out. */
export function asHubItems(v: unknown): HubItem[] {
  if (!Array.isArray(v)) return []
  const items: HubItem[] = []
  for (const raw of v) {
    const at = typeof raw?.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0
    const item = hubItemFrom(raw, at)
    if (!('error' in item)) items.push(item)
  }
  return items.slice(-MAX_HUB_ITEMS)
}

/** The hub with `item` added, and the keepsake it retired to make room, if any. */
export function addHubItem(items: readonly HubItem[], item: HubItem): { items: HubItem[]; retired?: HubItem } {
  const all = [...items, item]
  return { items: all.slice(-MAX_HUB_ITEMS), retired: all.length > MAX_HUB_ITEMS ? all[0] : undefined }
}
