// The scene language Sonnet writes: a setting, a mood, props on the ground, and
// beats the Claude figure performs one after another.

export const SETTINGS = ['meadow', 'forest', 'cave', 'night', 'desert', 'library', 'space', 'beach'] as const
export type Setting = (typeof SETTINGS)[number]

export const PROP_KINDS = [
  'sign', 'tree', 'rock', 'chest', 'bug', 'crate', 'scroll', 'flag',
  'lamp', 'books', 'computer', 'cactus', 'mushroom',
] as const
export type PropKind = (typeof PROP_KINDS)[number]

export const MOODS = [
  'neutral', 'happy', 'proud', 'love', 'sad', 'angry', 'surprised', 'confused', 'sleepy', 'focused', 'worried',
] as const
export type Mood = (typeof MOODS)[number]

export type Prop = { id: string; kind: PropKind; x: number; label?: string }

export type Beat = BeatAction & { caption?: string }

export type BeatAction =
  | { do: 'walk'; to: number }
  | { do: 'run'; to: number }
  | { do: 'say'; text: string; secs?: number }
  | { do: 'think'; text: string; secs?: number }
  | { do: 'look'; at: string; react?: '!' | '?' }
  | { do: 'squash'; at: string }
  | { do: 'transform'; at: string; into: PropKind; label?: string }
  | { do: 'plant_sign'; id: string; label: string; x: number }
  | { do: 'pull_sign'; at: string }
  | { do: 'carry'; at: string }
  | { do: 'drop' }
  | { do: 'type'; at?: string; secs?: number }
  | { do: 'read'; secs?: number }
  | { do: 'emote'; mood: Mood; secs?: number }
  | { do: 'dance'; secs?: number }
  | { do: 'wave' }
  | { do: 'shrug' }
  | { do: 'jump' }
  | { do: 'dig'; secs?: number }
  | { do: 'celebrate' }
  | { do: 'ponder'; secs?: number }
  | { do: 'wait'; secs: number }

/** `continues`: plays in the current turn's world (its setting and props, as they now are). */
export const HATS = ['none', 'wizard', 'miner', 'straw', 'tophat', 'nightcap'] as const
export type Hat = (typeof HATS)[number]

/**
 * `stamp`: when the director staged it (ms), for the latency figures; scenes made locally have none.
 * `isNews`: it stages new activity (or the turn's end), so the scene playing may give way to it at a pause.
 */
export type Scene = {
  setting: Setting; mood: Mood; props: Prop[]; beats: Beat[]; hat?: Hat; continues?: boolean
  stamp?: Stamp
  isNews?: boolean
}

export type Stamp = {
  kind: 'first' | 'scene' | 'interlude' | 'wrap'
  /** The oldest activity it stages; none for an interlude. */
  activity?: number
  asked: number
  answered: number
  /** What the stage expected to have left to play when it was asked for (ms). */
  expectedLeftMs: number
}

const MAX_PROPS = 4
const MAX_BEATS = 9 // the strip stays calm: anything past this is dropped
export const MAX_SPEECH = 110
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const str = (v: unknown, max: number) => (typeof v === 'string' ? clip(v.trim().replace(/\s+/g, ' '), max) : '')

/** Cuts at a word boundary and marks the cut, so a remark never ends mid-word. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '…'
}
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const secs = (v: unknown, lo: number, hi: number) => (v === undefined ? undefined : clamp(num(v, lo), lo, hi))
const isMood = (v: unknown): v is Mood => MOODS.includes(v as Mood)

/**
 * Pulls the first JSON object out of a reply and holds it to the language. Given the
 * turn's `world`, the scene plays in it: its own setting and props are ignored.
 */
export function parseScene(reply: string, world?: { setting: Setting; props: readonly Prop[] }): Scene | { error: string } {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return { error: 'no JSON object in the reply' }

  let raw: any
  try {
    raw = JSON.parse(reply.slice(start, end + 1))
  } catch (err) {
    return { error: `bad JSON: ${String(err).slice(0, 80)}` }
  }

  const setting: Setting = world?.setting ?? (SETTINGS.includes(raw?.setting) ? raw.setting : 'meadow')
  const mood: Mood = isMood(raw?.mood) ? raw.mood : 'neutral'
  // the hat comes with the world: a later scene of the turn keeps the one Claude already wears
  const hat: Hat | undefined = world ? undefined : HATS.includes(raw?.hat) ? raw.hat : 'none'

  const props: Prop[] = []
  for (const p of world ? [] : Array.isArray(raw?.props) ? raw.props.slice(0, MAX_PROPS) : []) {
    if (!PROP_KINDS.includes(p?.kind)) continue
    const id = str(p.id, 20) || `p${props.length}`
    const label = str(p.label, 22) || undefined
    props.push({ id, kind: p.kind, x: clamp(num(p.x, 50), 0, 100), label })
  }
  if (world) props.push(...world.props.map(p => ({ ...p })))
  const ids = new Set(props.map(p => p.id))
  const signs = new Set(props.filter(p => p.kind === 'sign').map(p => p.id))

  const beats: Beat[] = []
  for (const b of Array.isArray(raw?.beats) ? raw.beats.slice(0, MAX_BEATS) : []) {
    switch (b?.do) {
      case 'walk':
      case 'run':
        beats.push({ do: b.do, to: clamp(num(b.to, 50), 0, 100) })
        break
      case 'say':
      case 'think': {
        const text = str(b.text, MAX_SPEECH)
        if (text) beats.push({ do: b.do, text, secs: secs(b.secs, 1, 8) })
        break
      }
      case 'look':
        if (ids.has(b.at)) beats.push({ do: 'look', at: b.at, react: b.react === '!' || b.react === '?' ? b.react : undefined })
        break
      case 'squash':
      case 'carry':
        if (ids.has(b.at)) beats.push({ do: b.do, at: b.at })
        break
      case 'plant_sign': {
        const label = str(b.label, 22)
        if (!label) break
        // a fresh id, so later beats (and scenes) can look at or pull this sign
        let id = str(b.id, 20) || 'note'
        for (let n = 2; ids.has(id); n++) id = `${str(b.id, 18) || 'note'}${n}`
        ids.add(id)
        signs.add(id)
        beats.push({ do: 'plant_sign', id, label, x: clamp(num(b.x, 50), 0, 100) })
        break
      }
      case 'pull_sign':
        if (signs.has(b.at)) beats.push({ do: 'pull_sign', at: b.at })
        break
      case 'transform':
        if (ids.has(b.at) && PROP_KINDS.includes(b.into)) {
          beats.push({ do: 'transform', at: b.at, into: b.into, label: str(b.label, 22) || undefined })
        }
        break
      case 'type':
        beats.push({ do: 'type', at: ids.has(b.at) ? b.at : undefined, secs: secs(b.secs, 1, 5) })
        break
      case 'emote':
        if (isMood(b.mood)) beats.push({ do: 'emote', mood: b.mood, secs: secs(b.secs, 1, 5) })
        break
      case 'read':
      case 'dance':
        beats.push({ do: b.do, secs: secs(b.secs, 1, 5) })
        break
      case 'sleep': // sleeping is the sleepy mood, not an action of its own
        beats.push({ do: 'emote', mood: 'sleepy', secs: secs(b.secs, 1, 5) ?? 4 })
        break
      case 'ponder':
        beats.push({ do: 'ponder', secs: secs(b.secs, 1.5, 6) })
        break
      case 'drop':
      case 'wave':
      case 'shrug':
      case 'jump':
      case 'celebrate':
        beats.push({ do: b.do })
        break
      case 'dig':
        beats.push({ do: 'dig', secs: secs(b.secs, 1, 4) })
        break
      case 'wait':
        beats.push({ do: 'wait', secs: clamp(num(b.secs, 1), 0.3, 4) })
        break
    }
  }
  if (beats.length === 0) return { error: 'the scene has no usable beats' }

  return { setting, mood, props, beats, hat, continues: world ? true : undefined }
}
