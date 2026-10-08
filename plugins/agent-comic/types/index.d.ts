// agent-comic's contract: its state, and $.comic, through which other plugins add places
// to the comic's world. EXTENDING.md says how to build one.

/**
 * What the band is doing. `working`: a turn runs and the comic plays it. `wrapping`: the turn
 * ended and its closing scene still plays (or a /comic-demo, a /comic-feel). `idle`: the band is
 * free; the place in `here` draws it. `hidden`: nothing is to show between turns (the comic is
 * off, or "Show when idle" is).
 */
export type ComicState = 'working' | 'wrapping' | 'idle' | 'hidden'

/** A place in the comic's world: `id` is its plugin's name, `name` the word on the signs to it. */
export type ComicPlace = { id: string; name: string }

/** A stop on the ring of places: a place, or the hub (`id` null). */
export type ComicStop = { id: string | null; name: string }

/** The side of the band: -1 left, 1 right. */
export type ComicSide = -1 | 1

/** Pixel art: one letter per pixel, '.' transparent, each letter's colour (0xRRGGBB) in `palette`. */
export type ComicArt = { rows: string[]; palette: Record<string, number> }

/**
 * The comic's own art, so a place draws the same Claude in the same palette. Every frame faces
 * right; mirror each row for one facing left.
 */
export type ComicKit = {
  /** Claude, 11 wide and 7 tall, standing on his last row; `walk` is a four-frame cycle. */
  claude: {
    stand: string[]; blink: string[]; happy: string[]; asleep: string[]; wave: string[]; walk: string[][]
    palette: Record<string, number>
  }
  /** Hats, 11 wide like him: `sit` rows of the brim rest over his head's top row. */
  hats: Record<string, ComicArt & { sit: number }>
  /** The wooden signs' colours: text, board, border. */
  sign: { fg: number; bg: number; border: number }
  /** The comic's palette by name (Endesga 32). */
  palette: Record<string, number>
}

/** $.comic. Every call goes through the hook chain, so each answers a promise. */
export type Comic = {
  /** The version of this interface: 1. It grows when something is added; what is here does not change. */
  version: () => Promise<number>
  /** Adds a place to the ring, or renames it. Call it at each session.start; calling again is harmless. */
  addPlace: (place: ComicPlace) => Promise<void>
  /** Takes a place off the ring; Claude comes home to the hub if he was there. */
  removePlace: (place: { id: string }) => Promise<void>
  /** The ring, in order: the hub first, then the places by id. */
  places: () => Promise<ComicStop[]>
  /** The signs from where he is now: the stop to the left and to the right, null where there is no sign. */
  route: () => Promise<{ left: ComicStop | null; right: ComicStop | null }>
  /** Goes to a place by id, or home to the hub with null. An unknown id is ignored. */
  go: (to: { id: string | null }) => Promise<void>
  /** Follows the sign on that side, if there is one. */
  step: (to: { dir: ComicSide }) => Promise<void>
  /**
   * Says the place is still drawing. The place in `here` calls it every second or so while it
   * draws; silent for a few seconds, Claude comes home to the hub. It adds the place if the ring
   * lost it (the comic reloaded).
   */
  alive: (place: ComicPlace) => Promise<void>
  /** The comic's art: Claude, his hats, the sign colours, the palette. */
  kit: () => Promise<ComicKit>
}

declare module 'claude-code' {
  interface EngineInterface {
    comic: Comic
  }
  interface PluginState {
    'agent-comic': {
      enabled: boolean
      lingering: boolean
      /** What the band is doing; a place draws only while it is `idle` and `here` is the place. */
      state: ComicState
      /** Where Claude is between turns: null for the hub, else a place's id. */
      here: string | null
      /** The side he came in from as he got here by a sign, null otherwise. */
      cameFrom: ComicSide | null
      /** The ring as places() answers it. */
      places: ComicStop[]
    }
  }
}
