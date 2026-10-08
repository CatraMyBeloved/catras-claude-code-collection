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
