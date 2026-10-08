// Pixel art. One letter per pixel, '.' transparent; sprites stand on their last row.
// One palette for everything (Endesga 32), light from the top left: each object
// is a ramp of highlight, base and a hue-shifted shadow, no lone pixels.

import type { Mood, PropKind, Setting } from './scene'

export const P = {
  ink: 0x181425, night: 0x262b44, slate: 0x3a4466, steel: 0x5a6988, mist: 0x8b9bb4, silver: 0xc0cbdc, white: 0xffffff,
  wine: 0x3e2731, bark: 0x733e39, wood: 0xb86f50, tan: 0xe4a672, sand: 0xead4aa, skin: 0xe8b796, clay: 0xc28569,
  blood: 0xa22633, red: 0xe43b44, coral: 0xf6757a, rust: 0xbe4a2f, amber: 0xfeae34, yellow: 0xfee761,
  leaf: 0x63c74d, moss: 0x3e8948, pine: 0x265c42, deep: 0x193c3e,
  navy: 0x124e89, sky: 0x0099db, plum: 0x68386c, pink: 0xb55088,
}

// Claude's own orange, with a warm highlight and a shadow shifted toward red;
// moods tint the whole ramp (hotter when angry, dustier when sad).
export const ORANGE = 0xd97757
export const TINTS = {
  normal: { h: 0xeea27d, O: ORANGE, s: 0xb4533f, E: P.ink },
  angry: { h: 0xf0866a, O: 0xe0553f, s: 0xa8342c, E: P.ink },
  sad: { h: 0xd3a48f, O: 0xb88370, s: 0x8a5a50, E: P.ink },
}
export type Tint = keyof typeof TINTS

export const CLAUDE_WIDTH = 11
export const CLAUDE_HEIGHT = 7

export type Face = 'ahead' | 'right' | 'down' | 'blink' | 'shut' | 'happy' | 'sad' | 'angry' | 'wide' | 'squint' | 'focused' | 'confused'
export type Arm = 'down' | 'mid' | 'up'

// eye pixels as [row, column] in the 11-wide body, facing right
const FACES: Record<Face, [number, number, 'E' | 's'][]> = {
  ahead: [[1, 3, 'E'], [2, 3, 'E'], [1, 7, 'E'], [2, 7, 'E']],
  right: [[1, 4, 'E'], [2, 4, 'E'], [1, 8, 'E'], [2, 8, 'E']],
  down: [[2, 3, 'E'], [3, 3, 'E'], [2, 7, 'E'], [3, 7, 'E']],
  blink: [[2, 3, 's'], [2, 7, 's']],
  shut: [[2, 3, 's'], [2, 4, 's'], [2, 6, 's'], [2, 7, 's']],
  happy: [[1, 3, 'E'], [2, 2, 'E'], [2, 4, 'E'], [1, 7, 'E'], [2, 6, 'E'], [2, 8, 'E']],
  sad: [[2, 3, 'E'], [3, 3, 'E'], [2, 7, 'E'], [3, 7, 'E'], [1, 4, 's'], [1, 6, 's']],
  angry: [[1, 4, 'E'], [2, 3, 'E'], [2, 4, 'E'], [1, 6, 'E'], [2, 6, 'E'], [2, 7, 'E']],
  wide: [[1, 3, 'E'], [1, 4, 'E'], [2, 3, 'E'], [2, 4, 'E'], [1, 6, 'E'], [1, 7, 'E'], [2, 6, 'E'], [2, 7, 'E']],
  squint: [[2, 3, 'E'], [2, 4, 'E'], [2, 7, 'E'], [2, 8, 'E']],
  focused: [[2, 3, 'E'], [2, 4, 'E'], [2, 6, 'E'], [2, 7, 'E']],
  confused: [[1, 3, 'E'], [2, 3, 'E'], [2, 7, 'E'], [2, 8, 'E'], [0, 8, 's']],
}

const LEGS = {
  stand: ['..s.s.s.s..', '..s.s.s.s..'],
  passA: ['..s.s.s.s..', '....s...s..'],
  passB: ['..s.s.s.s..', '..s...s....'],
  tuck: ['...s.s.s...', '...........'],
}

export type Pose = { face: Face; back: Arm; front: Arm; walk: number; airborne: boolean; crouch: boolean; left: boolean }

/**
 * The Claude figure, 11 wide and 7 tall (6 crouched). Built from parts so faces,
 * arms and legs combine freely, then mirrored for `left`, then lit: the light
 * comes from the top left whichever way he faces.
 */
export function claude(pose: Pose): string[] {
  const grid = [
    '..OOOOOOO..',
    '..OOOOOOO..',
    '..OOOOOOO..',
    '..OOOOOOO..',
    '..sssssss..',
  ].map(r => r.split(''))
  // arms: down at the waist line, raised one row, or up with the hand above the head
  const arm = (state: Arm, cols: [number, number]) => {
    const [inner, outer] = cols
    if (state === 'down') {
      grid[2]![inner] = 'O'
      grid[2]![outer] = 'O'
    } else if (state === 'mid') {
      grid[1]![inner] = 'O'
      grid[1]![outer] = 'O'
    } else {
      grid[1]![inner] = 'O'
      grid[0]![outer] = 'O'
    }
  }
  arm(pose.back, [1, 0])
  arm(pose.front, [9, 10])
  for (const [r, c, ch] of FACES[pose.face]) grid[r]![c] = ch
  if (pose.left) for (const row of grid) row.reverse()

  // light in screen space: a highlight along the top and the left rim, shade down the right edge
  const lit = (r: number, c: number, ch: 'h' | 's') => {
    if (grid[r]![c] === 'O') grid[r]![c] = ch
  }
  // the top row is lit right up to the far corner; below it only the left rim catches light
  for (let c = 0; c <= 7; c++) lit(0, c, 'h')
  for (let r = 1; r <= 2; r++) lit(r, 2, 'h')
  for (let r = 1; r <= 3; r++) lit(r, 8, 's')

  // a crouch folds the legs, never the body, so the outline stays whole
  const step = [LEGS.stand, LEGS.passA, LEGS.stand, LEGS.passB][pose.walk % 4]!
  const legs = pose.airborne ? LEGS.tuck : pose.crouch ? [step[1]!] : step
  return [...grid.map(r => r.join('')), ...legs.map(l => (pose.left ? [...l].reverse().join('') : l))]
}

/**
 * A helper (a subagent): a small Claude, 7 wide and 5 tall, built and lit like the big one.
 * `walk` picks the leg frame; `left` mirrors it.
 */
export function miniClaude(pose: { walk: number; blink: boolean; left: boolean }): string[] {
  const grid = [
    '.OOOOO.',
    pose.blink ? '.OsOsO.' : '.OEOEO.',
    'OOOOOOO',
    '.sssss.',
    pose.walk % 2 ? '.s...s.' : '.s.s.s.',
  ].map(r => r.split(''))
  if (pose.left) for (const row of grid) row.reverse()
  for (let c = 1; c <= 4; c++) if (grid[0]![c] === 'O') grid[0]![c] = 'h'
  if (grid[1]![1] === 'O') grid[1]![1] = 'h'
  if (grid[1]![5] === 'O') grid[1]![5] = 's'
  return grid.map(r => r.join(''))
}

export const MINI_WIDTH = 7
export const MINI_HEIGHT = 5

/**
 * Hats, 11 wide like Claude and facing right (mirrored with him). `sit` rows of the
 * brim rest over his head's top row; the rest stands above it.
 */
export const HATS_ART: Record<'wizard' | 'miner' | 'straw' | 'tophat' | 'nightcap', { rows: string[]; palette: Record<string, number>; sit: number }> = {
  wizard: {
    rows: ['......pP...', '.....pPP...', '....pPPP...', '...pPYPP...', '...pPPPPP..', '.DDDDDDDDD.'],
    palette: { P: P.plum, p: P.pink, D: P.wine, Y: P.yellow }, sit: 0,
  },
  miner: {
    rows: ['....YWY....', '...AAWAA...', '..aAAAAAA..', '.BBBBBBBBB.'],
    palette: { A: P.amber, a: P.tan, W: P.white, Y: P.yellow, B: P.bark }, sit: 0,
  },
  straw: {
    rows: ['...TSSSS...', '...RRRRR...', 'TSSSSSSSSSS'],
    palette: { S: P.sand, T: P.tan, R: P.red }, sit: 1,
  },
  tophat: {
    rows: ['...kKKKK...', '...kKKKK...', '...kKKKK...', '...RRRRR...', '..kKKKKKK..'],
    palette: { K: P.night, k: P.slate, R: P.red }, sit: 0,
  },
  nightcap: {
    rows: ['....nNNn...', '...nNNNNNn.', '..nNNNNN.Nn', '..wwwwwww.W'],
    palette: { N: P.navy, n: P.sky, w: P.silver, W: P.white }, sit: 0,
  },
}

/** Little pixel props the figure holds or the moods give off. */
export const BITS = {
  book: { rows: ['wwswW', 'wwsWW', 'bbbbb'], palette: { w: P.white, W: P.sand, s: P.mist, b: P.blood } },
  bookFlip: { rows: ['wwsww', 'wwsWW', 'bbbbb'], palette: { w: P.white, W: P.sand, s: P.mist, b: P.blood } },
  // a shovel held at the hand, blade down; the raised frame carries a clod of dirt
  shovel: { rows: ['h...', '.h..', '..h.', '..h.', '.bBb', '.bBb'], palette: { h: P.wood, b: P.silver, B: P.mist } },
  shovelUp: { rows: ['h...', '.h..', '..h.', '.dbb', '.bBb'], palette: { h: P.wood, b: P.silver, B: P.mist, d: P.bark } },
  miniBook: { rows: ['wsw', 'bbb'], palette: { w: P.white, s: P.mist, b: P.blood } },
  heart: { rows: ['.h.r.', 'hrrrd', '.rrd.', '..d..'], palette: { h: P.coral, r: P.red, d: P.blood } },
}

type Art = { rows: readonly string[]; palette: Record<string, number> }

/** An RPG emote balloon: white, 9 by 8 with a tail, the icon set into it at (2, 1). */
export const BALLOON = {
  rows: ['.wwwwwww.', 'wwwwwwwww', 'wwwwwwwww', 'wwwwwwwww', 'wwwwwwwww', 'wwwwwwwww', '.wwwwwww.', '...ww....'],
  palette: { w: P.white },
}

/** What each mood says in its balloon, 5 by 5, drawn on white. */
export const MOOD_ICONS: Record<Exclude<Mood, 'neutral'>, Art> = {
  happy: { rows: ['..kkk', '..k.k', '..k..', 'kkk..', 'kkk..'], palette: { k: P.night } },
  proud: { rows: ['..y..', 'yyayy', '.yay.', 'yy.yy', 'y...y'], palette: { y: P.amber, a: P.yellow } },
  love: { rows: ['.r.r.', 'rhrrr', 'rrrrd', '.rrd.', '..d..'], palette: { r: P.red, h: P.coral, d: P.blood } },
  sad: { rows: ['.ggg.', 'ggggg', '.....', 'b.b.b', '.b.b.'], palette: { g: P.steel, b: P.sky } },
  angry: { rows: ['rr.rr', 'r...r', '.....', 'r...r', 'rr.rr'], palette: { r: P.red } },
  surprised: { rows: ['..r..', '..r..', '..r..', '.....', '..r..'], palette: { r: P.red } },
  confused: { rows: ['.kkk.', 'k...k', '...k.', '.....', '..k..'], palette: { k: P.navy } },
  sleepy: { rows: ['kkkkk', '...k.', '..k..', '.k...', 'kkkkk'], palette: { k: P.slate } },
  focused: { rows: ['.....', '.....', 'k.k.k', '.....', '.....'], palette: { k: P.night } },
  worried: { rows: ['..b..', '.bbb.', 'bbbbb', 'bbhbb', '.bbb.'], palette: { b: P.sky, h: P.white } },
}

export const PROPS: Record<Exclude<PropKind, 'sign'>, Art> = {
  tree: {
    rows: ['..hhG..', '.hhGGG.', 'hhGGGGs', 'hGGGGss', '.GGGss.', '...Tt..', '...Tt..', '..TTtt.'],
    palette: { h: P.leaf, G: P.moss, s: P.pine, T: P.wood, t: P.bark },
  },
  rock: { rows: ['..hR...', '.hhRRs.', 'hRRRRss'], palette: { h: P.mist, R: P.steel, s: P.slate } },
  chest: {
    rows: ['.hhhhh.', 'hWWWWWd', 'GGGgGGG', 'dWWgWWd', 'ddddddd'],
    palette: { h: P.tan, W: P.wood, d: P.bark, G: P.amber, g: P.rust },
  },
  bug: {
    rows: ['.K.K.', 'hrKrd', 'rrKdd', 'K...K'],
    palette: { K: P.ink, h: P.coral, r: P.red, d: P.blood },
  },
  crate: {
    rows: ['DDDDD', 'DhcdD', 'DcdcD', 'DdccD', 'DDDDD'],
    palette: { D: P.bark, h: P.skin, c: P.clay, d: P.wood },
  },
  scroll: { rows: ['RhhhR', '.PpP.', '.PPp.', 'RPPPR'], palette: { R: P.bark, h: P.white, P: P.sand, p: P.tan } },
  flag: {
    rows: ['phhr', 'prrr', 'prrd', 'p...', 'p...', 'p...', 'pp..'],
    palette: { p: P.silver, h: P.coral, r: P.red, d: P.blood },
  },
  lamp: {
    rows: ['.y.', 'yYa', '.a.', '.s.', '.s.', '.s.', 'sss'],
    palette: { y: P.white, Y: P.yellow, a: P.amber, s: P.steel },
  },
  books: {
    rows: ['rr....', 'rdbb..', 'rdbbgy', 'rdbbgy'],
    palette: { r: P.red, d: P.blood, b: P.sky, g: P.moss, y: P.amber },
  },
  computer: {
    rows: ['hhhhhhh', 'hSgSSSs', 'hSSgSSs', 'sssssss', '...s...', '.sssss.'],
    palette: { h: P.silver, s: P.steel, S: P.navy, g: P.leaf },
  },
  cactus: {
    rows: ['..h..', 'h.hC.', 'hChCs', 'hCCC.', '..CCs', '..hC.', '..hC.'],
    palette: { h: P.leaf, C: P.moss, s: P.pine },
  },
  mushroom: {
    rows: ['.hrr.', 'hrwrd', 'rrrdd', '.SSs.', '..S..'],
    palette: { h: P.coral, r: P.red, d: P.blood, w: P.white, S: P.sand, s: P.tan },
  },
}

/** The waving flag's second frame. */
export const FLAG_WAVE = ['pphr', 'prrr', 'pdrr', 'p...', 'p...', 'p...', 'pp..']

export type FarKind = 'hills' | 'pines' | 'stalactites' | 'dunes' | 'shelves' | 'sea' | 'craters'

/** How a setting looks: ground ramp, a dim far layer, a sky detail, a few motes. */
export type Look = {
  grass: number
  grassHi: number
  dirt: number
  dirtDark: number
  tufts: boolean
  far: { kind: FarKind; color: number; accent: number }
  sky: 'none' | 'stars' | 'moon' | 'sun' | 'planet'
  mote: { color: number; motion: 'drift' | 'drip' | 'twinkle' | 'rise'; count: number }
}

export const LOOKS: Record<Setting, Look> = {
  meadow: {
    grass: P.moss, grassHi: P.leaf, dirt: P.bark, dirtDark: P.wine, tufts: true,
    far: { kind: 'hills', color: P.deep, accent: P.pine },
    sky: 'sun', mote: { color: P.yellow, motion: 'drift', count: 0 },
  },
  forest: {
    grass: P.pine, grassHi: P.moss, dirt: P.wine, dirtDark: P.ink, tufts: true,
    far: { kind: 'pines', color: 0x152c2e, accent: P.deep },
    sky: 'none', mote: { color: P.yellow, motion: 'twinkle', count: 5 },
  },
  cave: {
    grass: P.steel, grassHi: P.mist, dirt: P.slate, dirtDark: P.night, tufts: false,
    far: { kind: 'stalactites', color: P.night, accent: P.slate },
    sky: 'none', mote: { color: P.sky, motion: 'drip', count: 3 },
  },
  night: {
    grass: P.pine, grassHi: P.moss, dirt: P.deep, dirtDark: P.ink, tufts: true,
    far: { kind: 'hills', color: P.night, accent: P.slate },
    sky: 'moon', mote: { color: P.yellow, motion: 'twinkle', count: 4 },
  },
  desert: {
    grass: P.tan, grassHi: P.sand, dirt: P.wood, dirtDark: P.bark, tufts: false,
    far: { kind: 'dunes', color: 0x3b2a45, accent: P.plum },
    sky: 'sun', mote: { color: P.sand, motion: 'rise', count: 0 },
  },
  library: {
    grass: P.wood, grassHi: P.clay, dirt: P.bark, dirtDark: P.wine, tufts: false,
    far: { kind: 'shelves', color: P.wine, accent: P.bark },
    sky: 'none', mote: { color: P.mist, motion: 'drift', count: 0 },
  },
  space: {
    grass: P.steel, grassHi: P.mist, dirt: P.slate, dirtDark: P.night, tufts: false,
    far: { kind: 'craters', color: P.night, accent: P.slate },
    sky: 'planet', mote: { color: P.white, motion: 'twinkle', count: 6 },
  },
  beach: {
    grass: P.sand, grassHi: P.white, dirt: P.tan, dirtDark: P.wood, tufts: false,
    far: { kind: 'sea', color: 0x1b3460, accent: P.navy },
    sky: 'sun', mote: { color: P.white, motion: 'drift', count: 0 },
  },
}

export const SKY_ART: Record<'sun' | 'moon' | 'planet', Art> = {
  sun: { rows: ['.hY.', 'hYYa', 'YYaa', '.aa.'], palette: { h: P.white, Y: P.yellow, a: P.amber } },
  moon: { rows: ['.hm.', 'hmmM', 'mmMM', '.MM.'], palette: { h: P.white, m: P.silver, M: P.mist } },
  planet: { rows: ['..hp..', '.hpPP.', 'rrrrrr', '.pPPd.', '..Pd..'], palette: { h: P.pink, p: P.pink, P: P.plum, d: P.wine, r: P.tan } },
}

// spines behind the action: dark and desaturated, so the props in front stay readable
const BOOK_COLORS = [0x4a2a35, 0x2e3554, 0x24403a, 0x45294a, 0x553530, 0x3a3046]
export const bookColor = (i: number) => BOOK_COLORS[i % BOOK_COLORS.length]!
