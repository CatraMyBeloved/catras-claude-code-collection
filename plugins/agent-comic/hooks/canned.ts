// A token-free scene library: canned scenes in the same scene language the director writes,
// so the comic works with few or no model calls. Every scene goes through `parseScene`.

import { clip, parseScene, SETTINGS } from './scene'
import type { Hat, Prop, PropKind, Scene, Setting } from './scene'

/** One thing the agent did, as the comic needs it. Labels are already short, clean, single-line text (<= 20 chars), e.g. a file's base name. */
export type Activity =
  | { kind: 'read' | 'search' | 'edit' | 'run' | 'web'; label?: string }
  | { kind: 'test'; ok: boolean }
  | { kind: 'fail'; label?: string }
  | { kind: 'helper' }
  | { kind: 'commit' }
  | { kind: 'push' }
  | { kind: 'said'; text: string } // a remark the agent made to the person, already clipped

export type World = { setting: Setting; props: readonly Prop[] }

type Rand = () => number
type Raw = Record<string, unknown>

const pick = <T,>(list: readonly T[], rand: Rand): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!
const chance = (p: number, rand: Rand) => rand() < p
const between = (lo: number, hi: number, rand: Rand) => Math.round((lo + rand() * (hi - lo)) * 2) / 2
const shuffle = <T,>(list: readonly T[], rand: Rand): T[] => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

// ---- worlds ----

/** Props that belong in each place; one "work" prop is always included. */
const PLACES: Record<Setting, { work: PropKind[]; rest: PropKind[]; hats: Hat[] }> = {
  meadow: { work: ['computer', 'scroll'], rest: ['tree', 'rock', 'mushroom', 'flag', 'crate', 'bug', 'sign'], hats: ['straw', 'tophat'] },
  forest: { work: ['scroll', 'computer'], rest: ['tree', 'mushroom', 'rock', 'bug', 'sign', 'crate'], hats: ['straw', 'wizard'] },
  cave: { work: ['computer', 'scroll'], rest: ['rock', 'lamp', 'chest', 'mushroom', 'crate', 'bug'], hats: ['miner', 'miner'] },
  night: { work: ['scroll', 'computer'], rest: ['lamp', 'crate', 'flag', 'tree', 'mushroom'], hats: ['nightcap', 'wizard'] },
  desert: { work: ['computer', 'scroll'], rest: ['cactus', 'chest', 'rock', 'sign', 'crate', 'bug'], hats: ['straw', 'miner'] },
  library: { work: ['books', 'computer'], rest: ['lamp', 'scroll', 'crate', 'chest', 'bug'], hats: ['wizard', 'tophat'] },
  space: { work: ['computer', 'scroll'], rest: ['flag', 'rock', 'crate', 'lamp', 'sign', 'bug'], hats: ['wizard', 'tophat'] },
  beach: { work: ['scroll', 'computer'], rest: ['chest', 'crate', 'flag', 'rock', 'sign', 'bug'], hats: ['straw', 'straw'] },
}

const SIGN_LABELS = ['TODO', 'notes', 'here', 'hmm']

const KEYWORDS: [RegExp, Setting[]][] = [
  [/\b(docs?|documentation|readme|changelog|comments?|explain|guide)\b/i, ['library']],
  [/\b(bugs?|debug|crash(es)?|errors?|fix|broken|fail(s|ing|ed)?|exceptions?|regression)\b/i, ['cave', 'forest']],
  [/\b(deploy|release|publish|ship|ci|pipeline|version|bump)\b/i, ['space']],
  [/\b(data|search|find|query|grep|index|database|csv|logs?)\b/i, ['desert', 'beach']],
  [/\b(tests?|spec|coverage)\b/i, ['night', 'forest']],
  [/\b(refactor|clean|rename|move|tidy|lint)\b/i, ['meadow', 'night']],
  [/\b(web|api|http|fetch|network|server)\b/i, ['beach', 'space']],
]

/** Four props that belong in `setting`, spread across the ground: one to work at, three around it. */
export function cannedProps(setting: Setting, rand: Rand): Prop[] {
  const place = PLACES[setting]
  const kinds: PropKind[] = [pick(place.work, rand), ...shuffle(place.rest, rand).slice(0, 3)]
  const slots = shuffle([24, 44, 64, 84], rand)
  return shuffle(kinds, rand).map((kind, i) => {
    const p: Prop = { id: `${kind}${i}`, kind, x: slots[i]! + Math.round((rand() - 0.5) * 8) }
    if (kind === 'sign') p.label = pick(SIGN_LABELS, rand)
    return p
  })
}

/** The session's opening scene, setting up its world without a model. */
export function cannedFirst(goal: string, recent: readonly Setting[], rand: Rand): Scene {
  const last = recent[recent.length - 1]
  const lately = new Set(recent.slice(-3))
  const keyed = KEYWORDS.filter(([re]) => re.test(goal)).flatMap(([, s]) => s)
  const tiers = [
    keyed.filter(s => !lately.has(s)),
    SETTINGS.filter(s => !lately.has(s)),
    keyed.filter(s => s !== last),
    SETTINGS.filter(s => s !== last),
    [...SETTINGS],
  ]
  // a keyword hit is a lean, not a rule: now and then any fresh setting wins
  const tier = tiers[0]!.length && chance(0.8, rand) ? tiers[0]! : tiers.slice(1).find(t => t.length)!
  const setting = pick(tier, rand)

  const place = PLACES[setting]
  const props: Raw[] = cannedProps(setting, rand)
  const hat: Hat = chance(0.4, rand) ? pick(place.hats, rand) : 'none'

  const ids = props.map(p => p.id as string)
  const target = pick(ids, rand)
  const others = ids.filter(i => i !== target)
  const other = pick(others, rand)
  const topic = clip(goal.replace(/\s+/g, ' ').trim(), 60)
  const beats: Raw[] = [{ do: 'walk', to: between(8, 18, rand) }]
  beats.push({ do: 'look', at: target, react: chance(0.5, rand) ? '?' : undefined })
  if (chance(0.5, rand)) beats.push({ do: 'look', at: other })
  beats.push(topic && chance(0.6, rand) ? { do: 'think', text: topic, secs: 3 } : { do: 'ponder', secs: between(2, 3.5, rand) })
  return build({ setting, mood: pick(['neutral', 'focused', 'happy'] as const, rand), hat, props, beats }, undefined)
}

// ---- scenes in a world ----

type Ctx = { world: World; rand: Rand; ids: Set<string>; signs: number }
type Chunk = { beats: Raw[]; mood: string }

const of = (c: Ctx, ...kinds: PropKind[]): Prop | undefined => {
  const found = c.world.props.filter(p => kinds.includes(p.kind))
  return found.length ? pick(found, c.rand) : undefined
}
const spot = (c: Ctx) => between(12, 92, c.rand)
/** The widest gap between props, for a new sign. */
const freeX = (c: Ctx) => {
  const xs = [0, ...c.world.props.map(p => p.x), 100].sort((a, b) => a - b)
  let best = 50
  let gap = -1
  for (let i = 1; i < xs.length; i++) {
    if (xs[i]! - xs[i - 1]! > gap) {
      gap = xs[i]! - xs[i - 1]!
      best = (xs[i]! + xs[i - 1]!) / 2
    }
  }
  return Math.max(15, Math.min(90, Math.round(best)))
}
const lookAround = (c: Ctx): Raw[] => [{ do: 'walk', to: spot(c) }, { do: 'ponder', secs: between(1.5, 3, c.rand) }]

function readChunk(c: Ctx): Chunk {
  const src = of(c, 'books', 'scroll')
  if (src) return { mood: 'focused', beats: [{ do: 'look', at: src.id, react: chance(0.3, c.rand) ? '?' : undefined }, { do: 'read', secs: between(2, 3.5, c.rand) }] }
  return { mood: 'focused', beats: [{ do: 'read', secs: between(2, 3.5, c.rand) }, { do: 'ponder', secs: 2 }] }
}

function searchChunk(c: Ctx): Chunk {
  const rock = of(c, 'rock', 'mushroom', 'chest', 'cactus')
  if (rock) {
    const find = chance(0.4, c.rand)
    return {
      mood: find ? 'surprised' : 'focused',
      beats: [{ do: 'look', at: rock.id }, { do: 'dig', secs: between(2, 3.5, c.rand) }, find ? { do: 'emote', mood: 'surprised', secs: 1.5 } : { do: 'ponder', secs: 2 }],
    }
  }
  const lamp = of(c, 'lamp')
  if (lamp) return { mood: 'focused', beats: [{ do: 'look', at: lamp.id }, { do: 'walk', to: spot(c) }, { do: 'dig', secs: 2.5 }] }
  return { mood: 'focused', beats: [{ do: 'walk', to: spot(c) }, { do: 'dig', secs: between(2, 3.5, c.rand) }, { do: 'ponder', secs: 2 }] }
}

function editChunk(c: Ctx): Chunk {
  const crate = of(c, 'crate', 'scroll')
  const pc = of(c, 'computer')
  if (crate && (!pc || chance(0.5, c.rand))) {
    return { mood: 'focused', beats: [{ do: 'carry', at: crate.id }, { do: 'walk', to: spot(c) }, { do: 'drop' }, { do: 'ponder', secs: 1.5 }] }
  }
  if (pc) {
    return { mood: 'focused', beats: [{ do: 'type', at: pc.id, secs: between(2.5, 4, c.rand) }, chance(0.5, c.rand) ? { do: 'emote', mood: 'happy', secs: 1.5 } : { do: 'wait', secs: 1 }] }
  }
  return { mood: 'focused', beats: [{ do: 'type', secs: between(2.5, 4, c.rand) }, { do: 'ponder', secs: 2 }] }
}

function runChunk(c: Ctx): Chunk {
  const pc = of(c, 'computer')
  if (pc) return { mood: 'focused', beats: [{ do: 'type', at: pc.id, secs: between(2, 3, c.rand) }, { do: 'wait', secs: between(1, 2, c.rand) }, { do: 'look', at: pc.id }] }
  return { mood: 'focused', beats: [{ do: 'type', secs: 3 }, { do: 'wait', secs: 1.5 }] }
}

function webChunk(c: Ctx): Chunk {
  const far = of(c, 'scroll', 'lamp', 'flag')
  if (far) return { mood: 'surprised', beats: [{ do: 'look', at: far.id, react: '!' }, { do: 'read', secs: 2.5 }, { do: 'ponder', secs: 1.5 }] }
  return { mood: 'surprised', beats: [{ do: 'run', to: spot(c) }, { do: 'emote', mood: 'surprised', secs: 1.5 }, { do: 'read', secs: 2.5 }] }
}

function testChunk(c: Ctx, ok: boolean, afterFail: boolean): Chunk {
  const pc = of(c, 'computer')
  const bug = of(c, 'bug')
  const typed: Raw = pc ? { do: 'type', at: pc.id, secs: 2 } : { do: 'type', secs: 2 }
  const beats: Raw[] = [typed, { do: 'wait', secs: 1 }]
  if (ok) {
    // the bug stays: only Claude's own tool changes the world, so he just looks it over, pleased
    if (bug) beats.push({ do: 'look', at: bug.id, react: '!' })
    beats.push(afterFail || chance(0.6, c.rand) ? { do: 'celebrate' } : { do: 'dance', secs: 2 })
    return { mood: 'happy', beats }
  }
  if (bug && chance(0.5, c.rand)) beats.push({ do: 'look', at: bug.id, react: '!' })
  beats.push(chance(0.5, c.rand) ? { do: 'emote', mood: 'worried', secs: 2 } : { do: 'shrug' })
  return { mood: 'worried', beats }
}

function failChunk(c: Ctx): Chunk {
  const thing = of(c, 'bug', 'rock', 'crate')
  const beats: Raw[] = []
  if (thing) beats.push({ do: 'look', at: thing.id, react: '!' })
  beats.push({ do: 'emote', mood: pick(['worried', 'surprised', 'confused'] as const, c.rand), secs: 2 })
  beats.push(chance(0.5, c.rand) ? { do: 'shrug' } : { do: 'ponder', secs: 2 })
  return { mood: 'worried', beats }
}

function commitChunk(c: Ctx): Chunk {
  let id = 'saved'
  for (let n = 2; c.ids.has(id); n++) id = `saved${n}`
  c.ids.add(id)
  c.signs++
  return {
    mood: 'proud',
    beats: [
      { do: 'plant_sign', id, label: pick(['commit', 'saved', 'committed'], c.rand), x: freeX(c) },
      { do: 'look', at: id },
      chance(0.5, c.rand) ? { do: 'emote', mood: 'proud', secs: 2 } : { do: 'jump' },
    ],
  }
}

const pushChunk = (c: Ctx): Chunk => ({
  mood: 'happy',
  beats: chance(0.5, c.rand)
    ? [{ do: 'jump' }, { do: 'wait', secs: 0.5 }, { do: 'celebrate' }]
    : [{ do: 'emote', mood: 'surprised', secs: 1.5 }, { do: 'jump' }, { do: 'celebrate' }],
})

const helperChunk = (c: Ctx): Chunk => ({
  mood: 'happy',
  beats: [{ do: 'walk', to: between(10, 35, c.rand) }, { do: 'wave' }, { do: 'emote', mood: 'happy', secs: 1.5 }],
})

/** How soon an activity should be staged: failures first, plain reading last. */
const salience = (a: Activity): number => {
  switch (a.kind) {
    case 'fail': return 0
    case 'test': return a.ok ? 2 : 1
    case 'push': return 3
    case 'commit': return 4
    case 'helper': return 5
    case 'edit': return 6
    case 'run': return 7
    case 'web': return 8
    case 'search': return 9
    case 'read': return 10
    case 'said': return 11
  }
}

function chunkFor(a: Activity, c: Ctx, hadFail: boolean): Chunk | null {
  switch (a.kind) {
    case 'read': return readChunk(c)
    case 'search': return searchChunk(c)
    case 'edit': return editChunk(c)
    case 'run': return runChunk(c)
    case 'web': return webChunk(c)
    case 'test': return testChunk(c, a.ok, hadFail)
    case 'fail': return failChunk(c)
    case 'helper': return helperChunk(c)
    case 'commit': return c.signs < 1 ? commitChunk(c) : null
    case 'push': return pushChunk(c)
    case 'said': return null
  }
}

const MAX_BEATS = 5

/** A short scene in the current world acting out the freshest activities. */
export function cannedScene(acts: readonly Activity[], world: World, rand: Rand): Scene {
  const c: Ctx = { world, rand, ids: new Set(world.props.map(p => p.id)), signs: 0 }
  const hadFail = acts.some(a => a.kind === 'fail' || (a.kind === 'test' && !a.ok))
  const said = acts.filter((a): a is Extract<Activity, { kind: 'said' }> => a.kind === 'said').at(-1)
  const ranked = acts.filter(a => a.kind !== 'said').map((a, i) => ({ a, i })).sort((x, y) => salience(x.a) - salience(y.a) || x.i - y.i)

  const beats: Raw[] = []
  let mood = ''
  let kinds = 0
  const seen = new Set<string>()
  for (const { a } of ranked) {
    const key = a.kind === 'test' ? `test${a.ok}` : a.kind
    if (seen.has(key)) continue
    const ch = chunkFor(a, c, hadFail)
    if (!ch) continue
    // a second idea only when the first leaves room; each chunk plays whole (carry always meets its drop)
    if (kinds > 0 && (beats.length >= 3 || beats.length + ch.beats.length > MAX_BEATS - (said ? 1 : 0))) continue
    seen.add(key)
    beats.push(...ch.beats)
    mood ||= ch.mood
    if (++kinds >= 2) break
  }
  if (!beats.length) beats.push(...lookAround(c))
  if (said && beats.length < MAX_BEATS) {
    const text = clip(said.text.replace(/\s+/g, ' ').trim(), 60)
    if (text) beats.push({ do: 'say', text, secs: 4 })
  }
  return build({ mood: mood || 'neutral', beats: beats.slice(0, MAX_BEATS) }, world)
}

/** A quiet-moment interlude in the current world (n = 1..; the 4th is the last): small idle business, later ones sleepier. */
export function cannedInterlude(world: World, n: number, rand: Rand): Scene {
  const c: Ctx = { world, rand, ids: new Set(world.props.map(p => p.id)), signs: 0 }
  const prop = of(c, 'tree', 'lamp', 'flag', 'mushroom', 'rock', 'cactus', 'chest', 'crate', 'sign', 'bug', 'scroll', 'books', 'computer')
  const lookAt: Raw[] = prop ? [{ do: 'look', at: prop.id, react: chance(0.3, rand) ? '?' : undefined }] : []
  let beats: Raw[]
  let mood = 'neutral'
  if (n >= 4) {
    mood = 'sleepy'
    beats = [
      { do: 'think', text: pick(['Still working on it... *yawn*', 'So quiet... just resting my eyes.', 'Waiting is sleepy work.'], rand), secs: 3 },
      { do: 'emote', mood: 'sleepy', secs: 4 },
    ]
  } else if (n === 3) {
    mood = 'sleepy'
    beats = [...lookAt, { do: 'ponder', secs: 3 }, { do: 'think', text: pick(['Still going... I can wait.', 'Any moment now.', 'Hmm, patience.'], rand), secs: 3 }, { do: 'emote', mood: 'sleepy', secs: 2 }]
  } else if (n === 2) {
    const src = of(c, 'books', 'scroll')
    beats = src && chance(0.5, rand)
      ? [{ do: 'look', at: src.id }, { do: 'read', secs: 3 }, { do: 'ponder', secs: 2.5 }]
      : [...lookAt, { do: 'walk', to: spot(c) }, { do: 'ponder', secs: 3 }]
  } else {
    beats = chance(0.5, rand)
      ? [{ do: 'walk', to: spot(c) }, ...lookAt, { do: 'ponder', secs: 2.5 }]
      : [...lookAt, { do: 'wait', secs: 1.5 }, { do: 'walk', to: spot(c) }, { do: 'ponder', secs: 2.5 }]
  }
  return build({ mood, beats: beats.slice(0, MAX_BEATS) }, world)
}

const WRAP_LINES = ['Done!', 'That should do it.', 'All wrapped up.', 'There we go.', 'Finished, I think.']
const ABORT_LINES = ['Okay, stopping here.', 'Right, pausing for now.', 'Alright, I will leave it there.']

/** The turn's wrap-up in the current world. `aborted`: no celebration, a shrug or a small sigh instead. */
export function cannedWrap(world: World, lastSaid: string | undefined, aborted: boolean, rand: Rand): Scene {
  const c: Ctx = { world, rand, ids: new Set(world.props.map(p => p.id)), signs: 0 }
  const said = lastSaid ? clip(lastSaid.replace(/\s+/g, ' ').trim(), 60) : ''
  const prop = of(c, 'flag', 'chest', 'computer', 'tree', 'lamp', 'crate')
  if (aborted) {
    const beats: Raw[] = said || chance(0.5, rand)
      ? [{ do: 'say', text: said || pick(ABORT_LINES, rand), secs: 3 }, { do: 'shrug' }]
      : [{ do: 'emote', mood: 'sad', secs: 2 }, { do: 'ponder', secs: 2 }]
    return build({ mood: 'neutral', beats }, world)
  }
  const beats: Raw[] = []
  if (prop && chance(0.5, rand)) beats.push({ do: 'look', at: prop.id })
  beats.push({ do: 'say', text: said || pick(WRAP_LINES, rand), secs: 4 })
  beats.push(pick([{ do: 'celebrate' }, { do: 'wave' }, { do: 'emote', mood: 'happy', secs: 2 }] as Raw[], rand))
  if (chance(0.4, rand)) beats.push({ do: 'emote', mood: 'proud', secs: 2 })
  return build({ mood: pick(['happy', 'proud'] as const, rand), beats: beats.slice(0, MAX_BEATS) }, world)
}

/** Holds a raw scene to the language; on any trouble a minimal valid scene plays instead. */
function build(raw: Raw, world: World | undefined): Scene {
  try {
    const scene = parseScene(JSON.stringify(raw), world, { changes: 'none' })
    if (!('error' in scene)) return scene
  } catch { /* fall through to the fallback */ }
  const minimal = { setting: world?.setting ?? 'meadow', props: [], beats: [{ do: 'ponder', secs: 2 }] }
  const fallback = parseScene(JSON.stringify(minimal), world)
  if (!('error' in fallback)) return fallback
  return { setting: minimal.setting, mood: 'neutral', props: [], beats: [{ do: 'ponder', secs: 2 }], continues: world ? true : undefined }
}
