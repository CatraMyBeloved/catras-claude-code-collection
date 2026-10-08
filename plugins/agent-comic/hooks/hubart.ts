// Pixel art for the hub: keepsakes Claude collects, the door to a turn's world, clouds and rain.
// Same conventions as sprites.ts: one letter per pixel, '.' transparent, sprites stand on their
// last row, light from the top left, each object a ramp of highlight, base and a shadow.

import { P, type Look } from './sprites'

export const HUB_KINDS = ['trophy', 'medal', 'plant', 'flower', 'lantern', 'banner', 'gem', 'statue'] as const
export type HubKind = (typeof HUB_KINDS)[number]

type Art = { rows: readonly string[]; palette: Record<string, number> }

const ORANGE = 0xd97757

/** Keepsakes Claude adds to his hub: each at most 7 wide and 7 tall, standing on its last row. */
export const HUB_ART: Record<HubKind, Art> = {
  trophy: {
    rows: ['.hYYYa.', 'GhYYYaG', '.GYYaG.', '..aYa..', '...a...', '..bBb..', '.bBBBd.'],
    palette: { h: P.yellow, Y: P.amber, a: P.rust, G: P.amber, B: P.wood, b: P.tan, d: P.bark },
  },
  medal: {
    rows: ['rr...nn', '.rr.nn.', '..rrn..', '..hYa..', '.hYYYa.', '..aYa..', '.mMMMd.'],
    palette: { r: P.red, n: P.sky, h: P.yellow, Y: P.amber, a: P.rust, m: P.silver, M: P.mist, d: P.steel },
  },
  plant: {
    rows: ['..h.h..', '.hGhGs.', 'hGGsGGs', '..sGs..', '.TTTTd.', '..TRd..', '..RRd..'],
    palette: { h: P.leaf, G: P.moss, s: P.pine, T: P.tan, R: P.rust, d: P.bark },
  },
  flower: {
    rows: ['..hrr..', '.hrYrd.', '..rrd..', '...s...', '..LsL..', '.SSSSn.', '..SNn..'],
    palette: { h: P.coral, r: P.red, d: P.blood, Y: P.yellow, s: P.pine, L: P.moss, S: P.sky, N: P.navy, n: P.night },
  },
  lantern: {
    rows: ['..sss..', '.sWYas.', '.sYYas.', '.sssss.', '...T...', '...t...', '..ttt..'],
    palette: { s: P.steel, W: P.white, Y: P.yellow, a: P.amber, T: P.wood, t: P.bark },
  },
  banner: {
    rows: ['.TTTTT.', '.ThPPd.', '.TPYPd.', '.TPPPd.', '.TP.Pd.', '.T.....', 'bTb....'],
    palette: { T: P.wood, b: P.bark, h: P.pink, P: P.plum, d: P.wine, Y: P.yellow },
  },
  gem: {
    rows: ['...h...', '..hSn..', '.hSSSN.', '..SSN..', '...N...', '..mmd..', 'mmMMMdd'],
    palette: { h: P.white, S: P.sky, n: P.sky, N: P.navy, m: P.silver, M: P.mist, d: P.steel },
  },
  statue: {
    rows: ['.hhhhh.', '.hEOEs.', 'hOOOOOs', '..s.s..', 'mmmmmmm', '.MMMMd.', 'MMMMMdd'],
    palette: { h: 0xeea27d, O: ORANGE, s: 0xb4533f, E: P.ink, m: P.silver, M: P.mist, d: P.steel },
  },
}

/** The door to the turn's world, 7 wide and 10 tall, in a small stone frame, standing on its last row. */
export const DOOR: { closed: readonly string[]; open: readonly string[]; palette: Record<string, number> } = {
  closed: [
    '.mmmmm.',
    'mhWWWWd',
    'mhWbWWd',
    'mhWbWWd',
    'mhWbyWd',
    'mhWbWWd',
    'mhWbWWd',
    'mhWbWWd',
    'mhWbWWd',
    'MMMMMMM',
  ],
  open: [
    '.mmmmm.',
    'mbnnnnd',
    'mbnAAnd',
    'mbAYYAd',
    'mbAYYAd',
    'mbAYYAd',
    'mbAYYAd',
    'mbnAAnd',
    'mbnnnnd',
    'MMMMMMM',
  ],
  palette: { m: P.silver, M: P.mist, d: P.steel, h: P.tan, W: P.wood, b: P.bark, y: P.yellow, n: P.night, A: P.amber, Y: P.yellow },
}

/** The hub's look: a cosy home clearing under a sun, with dusky plum hills far away. */
export const HUB_LOOK: Look = {
  grass: 0x9c9a3e, grassHi: 0xc8c45a, dirt: P.bark, dirtDark: P.wine, tufts: true,
  far: { kind: 'hills', color: 0x4a2f4a, accent: 0x5e3a55 },
  sky: 'sun', mote: { color: P.yellow, motion: 'drift', count: 4 },
}

/** A small cloud, soft grey-white with a darker underside, and a darker rain-cloud variant. */
export const CLOUD: Art = {
  rows: ['...wwS....', '.wwwSSSS..', 'wSSSSSmmmm'],
  palette: { w: P.white, S: P.silver, m: P.mist },
}
export const RAIN_CLOUD: Art = {
  rows: ['...wwS....', '.wwwSSSS..', 'wSSSSSmmmm'],
  palette: { w: P.mist, S: P.steel, m: P.slate },
}

/** The colour of a rain drop streak. */
export const RAIN = P.sky

// ---- the garden and the den ----

/** A flower in 3 growth stages (sprout, bud, bloom), each 5 wide and at most 7 tall, standing on its last row. Petal pixels use the letter 'b' (bloom colour, swapped per flower) and 'B' (its shade); stem/leaves fixed greens. */
export const FLOWER_STAGES: readonly (readonly string[])[] = [
  ['.l.l.', '.lgl.', '..g..', '..g..'],
  ['..b..', '.bbB.', '.lgl.', '..g..', '..g..'],
  ['.bbb.', 'bbybB', '.bBB.', '..g..', '.lg..', '..gd.', '..g..'],
]
export function flowerPalette(petal: number, shade: number): Record<string, number> {
  return { b: petal, B: shade, y: P.amber, l: P.leaf, g: P.moss, d: P.pine }
}
/** Petal colour pairs [base, shade] to vary flowers: red, pink, yellow, sky-blue, white. */
export const FLOWER_COLORS: readonly (readonly [number, number])[] = [
  [P.red, P.blood], [0xf59ac0, 0xc2588f], [P.yellow, 0xe0a030], [0x4fb8ee, P.sky], [P.white, P.silver],
]

/** A watering can held at the hand, facing right (mirrored when he faces left). */
export const WATERING_CAN: Art = {
  rows: ['hh..s', 'hMMMs', 'hMMd.', '.ddd.'],
  palette: { h: P.silver, M: P.mist, d: P.steel, s: P.silver },
}

const COUCH = { t: 0x5a93a0, T: 0x3f7080, d: 0x2c4c5a, k: P.ink }
/** The couch behind Claude: backrest and armrests. 17 wide, 6 tall. */
export const COUCH_BACK: Art = {
  rows: [
    '..ttttttttttttt..',
    '..TTTTTTTTTTTTd..',
    'ttTTTTTTTTTTTTdTd',
    'TTTTTTTTTTTTTTdTd',
    'TTTTTTTTTTTTTTdTd',
    'ddddddddddddddddd',
  ],
  palette: COUCH,
}
/** The couch in front of Claude: the seat cushion front. 17 wide, 3 tall. */
export const COUCH_FRONT: Art = {
  rows: [
    'TTtttttttttttttTd',
    'TTTTTTTTTTTTTTdTd',
    'kdddddddddddddddk',
  ],
  palette: COUCH,
}

/** A TV on a low stand, 11 wide and 9 tall. The screen is drawn dark; TV_SCREEN is its inner rectangle. */
export const TV: Art = {
  rows: [
    'ggggggggggg',
    'fzzzzzzzzzF',
    'fzzzzzzzzzF',
    'fzzzzzzzzzF',
    'fzzzzzzzzzF',
    'fFFFFFFFFFF',
    '.ttttttttt.',
    '.WWWWWWWWb.',
    '.bb.....bb.',
  ],
  palette: { g: P.steel, f: P.slate, F: P.night, z: P.ink, t: P.tan, W: P.wood, b: P.bark },
}
export const TV_SCREEN = { x: 1, y: 1, w: 9, h: 4 }

/** A bed, 17 wide and 5 tall: pillow on the left, blanket on the right. */
export const BED: Art = {
  // a cool slate frame and white linen, so the orange sleeper stands out from it
  rows: [
    'f................',
    'fppp.............',
    'fpppmmmmmmmmmmmmf',
    'FFFFFFFFFFFFFFFFF',
    'll.............ll',
  ],
  palette: { f: P.steel, F: P.slate, l: P.night, p: P.white, m: P.silver, u: 0x7cc0e8, U: 0x4a8fc4 },
}
/** Where a lying Claude's head goes: on the pillow, just inside the headboard. */
export const BED_HEAD_X = 1
/** The blanket alone, same size as BED: draw it over a lying Claude so he is tucked in to the neck. */
export const BED_OVER: Art = {
  rows: [
    '.................',
    '.......uuuuuuuuu.',
    '......uUUUUUUUUUf',
    '.................',
    '.................',
  ],
  palette: BED.palette,
}
/** The nightcap he sleeps in, drawn over the top of his head as he lies: 6 wide, 2 tall. */
export const SLEEP_CAP: Art = {
  rows: ['W.nNN.', '.nNNNN'],
  palette: { n: P.sky, N: P.navy, W: P.white },
}

/** Claude lying on his back, head on the left: 12 wide, 4 tall, same palette keys as the figure. */
export function claudeLying(eyes: 'open' | 'shut'): string[] {
  const e = eyes === 'open' ? 'E' : 's'
  return ['..hhhhhh....', '.hOOOOOOOOs.', `hO${e}O${e}OOOOOOs`, 'ssssssssssss']
}

/** The den: indoors, a wooden floor, a dim back wall of shelves in warm browns, a few dust motes. */
export const DEN_LOOK: Look = {
  grass: 0x8a5a3c, grassHi: 0xa87450, dirt: 0x5a3a2e, dirtDark: P.wine, tufts: false,
  far: { kind: 'shelves', color: 0x3a2a30, accent: 0x54382f },
  sky: 'none', mote: { color: 0xc9a97a, motion: 'drift', count: 3 },
}
/** The garden: outdoors under a sun, teal pines far away, drifting pollen. */
export const GARDEN_LOOK: Look = {
  grass: 0x4f9a45, grassHi: 0x8fd35a, dirt: 0x7a4a36, dirtDark: P.wine, tufts: true,
  far: { kind: 'pines', color: 0x2f6b5a, accent: 0x3f8168 },
  sky: 'sun', mote: { color: 0xfbd5a0, motion: 'drift', count: 4 },
}
