// The tour /comic-demo plays: every mood once, then every action, each beat
// captioned with what it is meant to show.

import type { Beat, Mood, Scene } from './scene'

const MOOD_TOUR: [Exclude<Mood, 'neutral'>, string][] = [
  ['happy', '^ ^ eyes, a music note, sparkles'],
  ['proud', '^ ^ eyes, a star, lots of sparkles'],
  ['love', '^ ^ eyes, a heart, hearts floating up'],
  ['sad', 'drooping eyes, rain cloud, dusty colour, slumped, tears'],
  ['angry', 'slanted eyes, anger mark, red, shaking, steam'],
  ['surprised', 'big round eyes, "!"'],
  ['confused', 'uneven eyes, "?", looking both ways'],
  ['sleepy', 'closed eyes, Z, z’s drifting up, slow breathing'],
  ['focused', 'small eyes under a determined brow, "..."'],
  ['worried', 'sweat drop, trembling'],
]

const MOOD_SECS = 3.5

/** What each mood is meant to show, for captions. */
export const MOOD_SHOWS: Record<string, string> = Object.fromEntries(MOOD_TOUR)

/** The beat /comic-feel plays: one mood, acted out for five seconds with its caption. */
export function feelBeat(mood: Exclude<Mood, 'neutral'>): Beat {
  return { do: 'emote', mood, secs: 5, caption: `${mood} - ${MOOD_SHOWS[mood]}` }
}

export function demoScene(): Scene {
  const n = MOOD_TOUR.length
  const beats: Beat[] = [
    { do: 'walk', to: 22, caption: 'Comic tour: every mood, then every action' },
    ...MOOD_TOUR.map(([mood, shows], i): Beat => ({
      do: 'emote', mood, secs: MOOD_SECS, caption: `mood ${i + 1}/${n}: ${mood} - ${shows}`,
    })),
    { do: 'read', secs: 3, caption: 'action: read - holds an open book, eyes down, a page turns' },
    { do: 'type', at: 'pc', secs: 3, caption: 'action: type - walks to the computer, arms alternate, cursor races' },
    { do: 'carry', at: 'box', caption: 'action: carry - lifts the crate overhead' },
    { do: 'run', to: 92, caption: 'action: run - fast legs, dust behind' },
    { do: 'drop', caption: 'action: drop - sets the crate down where he stands' },
    { do: 'look', at: 'bug', react: '!', caption: 'action: look - walks to a prop, faces it, "!" or "?"' },
    { do: 'squash', at: 'bug', caption: 'action: squash - jumps on it, it vanishes in a puff' },
    { do: 'dig', secs: 2, caption: 'action: dig - bobs and throws dirt behind him' },
    { do: 'jump', caption: 'action: jump' },
    { do: 'wave', caption: 'action: wave - one arm up and down, happy eyes' },
    { do: 'shrug', caption: 'action: shrug - both arms up, squinting' },
    { do: 'dance', secs: 3, caption: 'action: dance - hops, turns, swaps arms, sparkles' },
    { do: 'say', text: 'This is a speech bubble: up to 110 characters, wrapped to fit.', secs: 4, caption: 'action: say' },
    { do: 'think', text: 'And this is a thought bubble.', secs: 3, caption: 'action: think' },
    { do: 'celebrate', caption: 'action: celebrate - arms up, hops, sparkles. End of tour!' },
  ]
  return {
    setting: 'meadow',
    mood: 'neutral',
    props: [
      { id: 'pc', kind: 'computer', x: 72 },
      { id: 'box', kind: 'crate', x: 45 },
      { id: 'bug', kind: 'bug', x: 58 },
    ],
    beats,
  }
}

/** Roughly how long the tour runs, with room for the walks between beats. */
export const DEMO_MS = (MOOD_TOUR.length * MOOD_SECS + 52) * 1000
