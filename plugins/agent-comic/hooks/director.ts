// What the director tells Sonnet, and how the agent's activity is summarized for it.

import { HATS, MOODS, PROP_KINDS, SETTINGS } from './scene'
import type { Scene } from './scene'

export const SYSTEM = `You are the director of a tiny animated comic strip shown in a terminal while an AI coding agent works.
The star is the agent itself: a small orange pixel creature ("Claude") who walks around a little world, inspects things and remarks on what it finds.
Each time you are called you get a log of what the agent just did (files read, commands run, searches, its own remarks) and you stage ONE short scene (about 6-15 seconds) that turns the latest activity into a visual metaphor.

Reply with ONLY a JSON object, no prose, no code fence:
{
  "setting": one of ${SETTINGS.map(s => `"${s}"`).join(', ')},
  "mood": one of ${MOODS.map(m => `"${m}"`).join(', ')}   (Claude's mood for the whole scene),
  "hat": one of ${HATS.map(h => `"${h}"`).join(', ')}   (first scene of the session only: Claude wears it with the world),
  "props": [ { "id": "short-id", "kind": one of ${PROP_KINDS.map(k => `"${k}"`).join(', ')}, "x": 0-100, "label": "optional, max 22 chars" } ],
  "beats": [ ... ]
}

Beats run in order:
  {"do":"walk","to":0-100}   {"do":"run","to":0-100}   (run kicks up dust: urgency, excitement)
  {"do":"look","at":"<prop id>","react":"!" or "?"}   (walks over to the prop by itself)
  {"do":"say","text":"aim for 40-80 chars, never over 100"}
  {"do":"think","text":"aim for 40-80 chars, never over 100"}
  {"do":"emote","mood":"<mood>","secs":2}   (a passing feeling: surprised at a find, worried at a risk, angry at a failure, love for nice code)
  {"do":"read","secs":3}   (holds an open book: reading files or docs)
  {"do":"type","at":"<computer prop id>"}   (walks to it and types: running commands, editing)
  {"do":"carry","at":"<prop id>"} then later {"do":"drop"}   (lifts a prop overhead and sets it down where Claude stands: moving or refactoring)
  {"do":"plant_sign","label":"max 22 chars","x":0-100,"id":"optional short id"}   (hammers a new sign into the ground: mark a finding, a file, a TODO)
  {"do":"pull_sign","at":"<sign id>"}   (pulls a sign out of the ground and it vanishes: done, fixed, or wrong after all)
  {"do":"ponder","secs":3}   (stands and contemplates: a "..." bubble, looks one way, then the other)
  {"do":"dance"}  {"do":"wave"}  {"do":"shrug"}  {"do":"dig"}  {"do":"jump"}  {"do":"celebrate"}  {"do":"wait","secs":1}

Guidelines:
- Unhurried. HARD LIMIT: 7 beats per scene (9 for an interlude); 5 is often best. At most 4 props, one idea per scene. Claude is calm and thoughtful,
  not busy: after picking something up, putting it down or finding something, give him a moment (ponder, wait, or a short emote)
  before the next thing. Fewer, deliberate actions beat many quick ones.
- Spread props out (x values at least 15 apart). Leave room near x=0 where Claude may stand.
- Whimsy over literalness: this is a storybook world, not an office. For each piece of work pick a surprising but fitting metaphor in any setting.
  The obvious one (a library for reading code) is allowed only now and then. Ideas, each one of many:
  reading or exploring code: a forest of signposts named after the files; beachcombing scrolls washed up by the sea; lamp-lit inscriptions in a cave; a sign on the moon.
  searching: digging for a chest in the desert or on the beach; lifting rocks to peek under them; hunting with a lamp at night.
  running commands or tests: typing at a computer planted somewhere odd (a dune, the moon, a beach) and waiting for its verdict.
  a bug or an error: a bug crawls out from behind a crate, rock or mushroom; Claude jumps back, surprised or worried.
  fixing it: stand over the bug and cheer; or carry the crate it hid behind to a better spot.
  writing or editing files: stacking crates, carrying a scroll to its sign, planting a flag.
  refactoring or moving code: carrying props from one place to another and setting them down in a new order.
  web research: a scroll from the sea, a signal from a far planet.  a long wait: night, a lamp, sitting by a mushroom, dozing.
- One world per session. The session's FIRST scene sets it up: a setting and exactly 4 props that belong together as one small place
  (a desert dig site: cactus, chest, rock, a sign; a night camp: lamp, crate, scroll, flag). Pick a place that can hold a whole
  session of work. Every later scene gets that world in the request: do not send "props" then, refer to the props by their ids.
  You never change the world: props are not destroyed or turned into other things in your scenes (the agent itself changes them
  with a tool of its own, and the request then shows the new world). Carrying a prop to another spot is fine.
- Signs are notes in the world, on top of the 4 props: when something concrete is found (a cause, a number, a file, a TODO),
  plant_sign it right there with a short label (aim for 14 characters or fewer: long boards crowd the strip);
  pull_sign one that is done or turned out wrong. At most 2 planted signs stand at once; they stay until pulled.
- A hat, chosen with the world in the session's first scene, fits its place and spirit: wizard (library, night, space, deep reading),
  miner (cave, digging, searching), straw (beach, desert, meadow), tophat (a proud or festive session), nightcap (night, long waits),
  or none. It stays on with the world.
- A "sign" shows its label on a board: use it for file names, commands, or search terms the agent is working on (e.g. "auth.ts", "npm test").
- Props are toys, not scenery: every scene has at least TWO interactions with its props (look at, carry and drop, type at, dig beside),
  ideally a tiny story: find something, react to it, do something about it.
- Use "read" at most once per scene, and not in two scenes in a row. Prefer carry, drop, type, dig, squash, run and the gestures.
- The setting is chosen once per session: its first scene picks it, every later scene stays in it.
  Vary the moods, actions and stories instead. Follow the variety notes in each request.
- Give Claude feelings: pick a scene mood that fits the work, and use at least one emote, action or gesture (wave, shrug, dance) per scene so the strip stays lively. Vary them between scenes.
- Speech is Claude remarking on REAL findings from the log: concrete, short, a little witty, first person. Never invent facts that are not in the log.
- Continuity lives in the story: the place and its props stay the same all session, so new turns can call back to earlier ones.`

export function buildPrompt(args: {
  goal: string | null
  log: readonly string[]
  fresh: number
  previous: Scene | null
  finished: boolean
  interlude?: { n: number; quietSecs: number; isLast: boolean }
  variety?: Variety
  world?: { setting: string; props: readonly { id: string; kind: string; label?: string; x: number }[]; gone: readonly string[]; hat?: string }
}): string {
  const older = args.log.slice(0, Math.max(0, args.log.length - args.fresh))
  const latest = args.log.slice(Math.max(0, args.log.length - args.fresh))
  const parts = [
    `The person asked the agent: ${args.goal ?? '(unknown)'}`,
    older.length ? `Earlier activity:\n${older.slice(-12).join('\n')}` : '',
    args.interlude
      ? interludeAsk(args.interlude)
      : `Latest activity (stage THIS):\n${latest.join('\n') || '(the agent is thinking)'}`,
    args.previous
      ? `Previous scene: setting=${args.previous.setting}, mood=${args.previous.mood}, props=${args.previous.props.map(p => `${p.kind}${p.label ? `(${p.label})` : ''}`).join(', ') || 'none'}`
      : 'This is the first scene.',
    args.world ? worldAsk(args.world) : 'This is the FIRST scene of the session: set up its world (setting and 4 related props). It stays for the whole session.',
    args.variety ? varietyAsk(args.variety, Boolean(args.interlude)) : '',
    args.finished
      ? 'The agent has just FINISHED its turn. Stage a short wrap-up scene: Claude sums up the outcome in one remark and celebrates or shrugs as fits.'
      : '',
  ]
  return parts.filter(Boolean).join('\n\n')
}

/** What the recent scenes leaned on, so the next one can lean elsewhere. */
export type Variety = { recentSettings: string[]; overused: string[]; suggest: string; banned?: string; locked?: string }

/**
 * Reads the last few scenes for the actions they used most, and the settings of
 * recent turns (`settings`, oldest first; the scenes' own when absent) for a setting to try.
 * `locked` is the session's setting once its first scene picked one.
 */
export function varietyNotes(
  recent: readonly Scene[],
  rand: () => number = Math.random,
  settings?: readonly string[],
  locked?: string,
): Variety {
  const recentSettings = [...(settings ?? recent.map(s => s.setting))]
  const counts = new Map<string, number>()
  for (const scene of recent.slice(-4)) for (const b of scene.beats) counts.set(b.do, (counts.get(b.do) ?? 0) + 1)
  const overused = [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([act, n]) => `${act} x${n}`)
  const lately = new Set(recentSettings.slice(-3))
  const fresh = SETTINGS.filter(s => !lately.has(s))
  const pool = fresh.length ? fresh : [...SETTINGS]
  const suggest = pool[Math.floor(rand() * pool.length)]!
  const [a, b] = recentSettings.slice(-2)
  return { recentSettings, overused, suggest, banned: a !== undefined && a === b ? a : undefined, locked }
}

function varietyAsk(v: Variety, isInterlude: boolean): string {
  const lines = ['Variety notes:']
  if (v.locked) {
    lines.push(`- the setting is fixed for this session: "${v.locked}". Stay in it; vary mood, actions and stories instead`)
  } else {
    if (v.recentSettings.length) lines.push(`- settings of recent turns, oldest first: ${v.recentSettings.join(', ')}`)
    lines.push('- this is the first scene of the session: it picks the setting for the whole session')
  }
  if (!isInterlude && !v.locked) {
    lines.push(`- suggested setting this time: ${v.suggest} (use it unless it truly cannot fit the work)`)
    if (v.banned) lines.push(`- do NOT use "${v.banned}" this time: the last two turns used it`)
  }
  if (v.overused.length) lines.push(`- used a lot lately, so go easy on them: ${v.overused.join(', ')}`)
  return lines.join('\n')
}

function worldAsk(w: NonNullable<Parameters<typeof buildPrompt>[0]['world']>): string {
  const props = w.props.map(p => `${p.id} = ${p.kind}${p.label ? ` "${p.label}"` : ''} at x=${p.x}`).join('; ')
  return `This session's world is set (do NOT send "props" or "hat"): setting ${w.setting}; hat ${w.hat ?? 'none'}; props: ${props || 'none left'}` +
    (w.gone.length ? `; gone: ${w.gone.join(', ')}` : '') +
    '. Use these ids. Keep every prop as it is: no transform, no squash.'
}

/** What to stage when nothing new has happened for a while but the agent is still at work. */
function interludeAsk(i: { n: number; quietSecs: number; isLast: boolean }): string {
  if (i.isLast) {
    return `No new activity for ${i.quietSecs}s; the agent is still busy. Stage a short scene in the same setting where Claude, ` +
      'still waiting, grows drowsy: a yawn-like remark, then {"do":"emote","mood":"sleepy","secs":4}. Invent no findings.'
  }
  return `INTERLUDE ${i.n}: no new activity for ${i.quietSecs}s, but the agent is still working (thinking, or a long command). ` +
    "Continue the previous scene's story in the same setting with 5-8 unhurried beats, pauses included (ponder, wait), so the strip does not stall: Claude keeps busy - " +
    'rereading or pacing, typing, carrying something, thinking aloud about what IS in the log, a small gesture, a light joke about the wait. ' +
    'Chain varied actions. Invent no findings and do not repeat the previous remarks.'
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s).replace(/\s+/g, ' ')

/** One log line for a tool call, from its input and how it ended. */
export function describeCall(e: Record<string, unknown>, outcome: { isError?: boolean; deny?: string; result?: unknown }): string {
  const tool = String(e.tool)
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  let what: string
  switch (tool) {
    case 'Read': what = `read ${s('file_path')}`; break
    case 'Edit': what = `edited ${s('file_path')}`; break
    case 'Write': what = `wrote ${s('file_path')}`; break
    case 'Bash': what = `ran \`${cut(s('command'), 80)}\``; break
    case 'Grep': what = `searched for "${cut(s('pattern'), 40)}"${s('path') ? ` in ${s('path')}` : ''}`; break
    case 'Glob': what = `listed files matching ${s('pattern')}`; break
    case 'WebFetch': what = `fetched ${s('url')}`; break
    case 'WebSearch': what = `searched the web for "${cut(s('query'), 50)}"`; break
    case 'Agent': what = `sent a helper agent: ${cut(s('description') || s('prompt'), 60)}`; break
    default: {
      const args = JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['tool', 'tool_use_id', 'agentId'].includes(k))))
      what = `used ${tool} ${cut(args ?? '', 70)}`
    }
  }
  if (e.agentId) what = `(helper) ${what}`
  if (outcome.deny) return `${what} -> blocked`
  const result = summarize(outcome.result)
  if (outcome.isError) return `${what} -> FAILED${result ? `: ${result}` : ''}`
  return result ? `${what} -> ${result}` : what
}

function summarize(result: unknown): string {
  if (result === undefined || result === null) return ''
  let text: string
  if (typeof result === 'string') text = result
  else {
    const r = result as Record<string, unknown>
    text = typeof r.stdout === 'string' || typeof r.stderr === 'string'
      ? `${r.stdout ?? ''} ${r.stderr ?? ''}`
      : typeof r.content === 'string' ? r.content : (JSON.stringify(result) ?? '')
  }
  return cut(text.trim(), 140)
}
