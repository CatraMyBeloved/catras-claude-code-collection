// The session's world: a setting, a hat and a few props, set up by the session's first scene.
// It stays put for the whole session; only Claude changes it, with the comic's world tool.

import { cannedProps } from './canned'
import { cellText } from './canvas'
import { HATS, PROP_KINDS, SETTINGS, clip } from './scene'
import type { Hat, Prop, PropKind, Setting } from './scene'

export type SessionWorld = { setting: Setting; props: Prop[]; hat: Hat }

export const WORLD_TOOL = 'world_change'
export const MAX_PROP_CHANGES = 6 // per session: the world changes now and then, not with every step
export const MAX_SCENERY_CHANGES = 2
const MAX_PROPS = 4
const MAX_LABEL = 22
const SLOTS = [24, 44, 64, 84]

/** The tool Claude calls, as `$.tool.register` takes it: deferred, so it costs nothing until looked up. */
export const WORLD_TOOL_SPEC = {
  name: WORLD_TOOL,
  description:
    'Change the little comic world shown above the prompt (agent-comic). The session\'s first scene sets up a world, ' +
    'a setting and a few props, and it stays put; only you change it. "look" lists it. "prop" changes one prop into ' +
    'another kind: the little Claude lifts it and it transforms (e.g. a scroll becomes a computer when the work moves ' +
    'from reading to running tests). "scenery" moves to a new setting: he summons a door and walks through into it. ' +
    `Purely for fun, never needed for the task. Use it rarely, when the work really changes: at most ${MAX_PROP_CHANGES} ` +
    `prop changes and ${MAX_SCENERY_CHANGES} scenery changes per session.`,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['look', 'prop', 'scenery'] },
      prop: { type: 'string', description: 'prop: the prop to change, by its id, label or kind (see "look")' },
      into: { type: 'string', enum: [...PROP_KINDS], description: 'prop: what it becomes' },
      label: { type: 'string', description: `prop: an optional label shown on it, at most ${MAX_LABEL} characters` },
      setting: { type: 'string', enum: [...SETTINGS], description: 'scenery: the new setting' },
      props: {
        type: 'array',
        maxItems: MAX_PROPS,
        description: 'scenery: up to 4 props that belong together there; left out, fitting ones are picked',
        items: {
          type: 'object',
          properties: { kind: { type: 'string', enum: [...PROP_KINDS] }, label: { type: 'string' } },
          required: ['kind'],
          additionalProperties: false,
        },
      },
      hat: { type: 'string', enum: [...HATS], description: 'scenery: an optional hat that fits the new place' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  isDeferred: true,
} as const

export type WorldChange =
  | { kind: 'look' }
  | { kind: 'prop'; id: string; into: PropKind; label?: string }
  | { kind: 'scenery'; world: SessionWorld }

const labelOf = (v: unknown) => (typeof v === 'string' ? clip(cellText(v).trim(), MAX_LABEL) || undefined : undefined)

/** The world as Claude reads it in the tool's answer. */
export function describeWorld(w: SessionWorld): string {
  const props = w.props.map(p => `${p.id} (${p.kind}${p.label ? ` "${p.label}"` : ''})`).join(', ')
  return `Setting: ${w.setting}. Hat: ${w.hat}. Props: ${props || 'none'}.`
}

/** The prop `ref` names: its id, else its label, else the first of its kind. */
export function findProp(w: SessionWorld, ref: string): Prop | undefined {
  const r = ref.trim().toLowerCase()
  return (
    w.props.find(p => p.id.toLowerCase() === r) ??
    w.props.find(p => p.label?.toLowerCase() === r) ??
    w.props.find(p => p.kind === r)
  )
}

/** What the tool's input asks of `world`, or why it cannot be done. */
export function worldChangeFrom(input: unknown, world: SessionWorld | null, rand: () => number = Math.random): WorldChange | { error: string } {
  const i = (input ?? {}) as Record<string, unknown>
  if (i.action === 'look') return { kind: 'look' }
  if (!world) return { error: 'the comic has no world yet: the session\'s first scene sets it up' }

  if (i.action === 'prop') {
    const prop = typeof i.prop === 'string' ? findProp(world, i.prop) : undefined
    if (!prop) return { error: `no such prop. ${describeWorld(world)}` }
    if (!PROP_KINDS.includes(i.into as PropKind)) return { error: `into must be one of: ${PROP_KINDS.join(', ')}` }
    const label = labelOf(i.label)
    if (prop.kind === i.into && prop.label === label) return { error: `${prop.id} already is that` }
    return { kind: 'prop', id: prop.id, into: i.into as PropKind, label }
  }

  if (i.action === 'scenery') {
    const setting = i.setting as Setting
    if (!SETTINGS.includes(setting)) return { error: `setting must be one of: ${SETTINGS.join(', ')}` }
    if (setting === world.setting) return { error: `the world already is a ${setting}; change a prop instead` }
    const asked = Array.isArray(i.props) ? i.props.slice(0, MAX_PROPS) : []
    const listed = asked.filter((p): p is { kind: PropKind; label?: unknown } => PROP_KINDS.includes((p as { kind?: PropKind })?.kind as PropKind))
    const props: Prop[] = listed.length
      ? listed.map((p, n) => ({ id: `${p.kind}${n}`, kind: p.kind, x: SLOTS[n]!, label: labelOf(p.label) }))
      : cannedProps(setting, rand)
    const hat = HATS.includes(i.hat as Hat) ? (i.hat as Hat) : world.hat
    return { kind: 'scenery', world: { setting, props, hat } }
  }

  return { error: 'action must be look, prop or scenery' }
}

/** `world` with one prop changed. */
export function withProp(world: SessionWorld, id: string, into: PropKind, label?: string): SessionWorld {
  return { ...world, props: world.props.map(p => (p.id === id ? { ...p, kind: into, label } : p)) }
}
