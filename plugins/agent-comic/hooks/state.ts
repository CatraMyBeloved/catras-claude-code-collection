// The comic's $.state, which places read (types/index.d.ts): whether the comic is on, what the band is
// doing, and where Claude is on the ring of places. And the moves along that ring (places.ts).

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ComicPlace, ComicSide, ComicState, ComicStop } from '../types'
import { ALIVE_MS, HUB, enteringFrom, routeOf, withPlace, withoutPlace } from './places'
import { settings } from './runtime'

// read and written only in this file, as the state scan requires: other modules use the functions below
const enabled = atom({ plugin: 'agent-comic', key: 'enabled' } as const, true)
/** The band stays up a while after a turn (and through a /comic-demo or a /comic-feel). */
const lingering = atom({ plugin: 'agent-comic', key: 'lingering' } as const, false)
const bandState = atom({ plugin: 'agent-comic', key: 'state' } as const, 'hidden' as ComicState)
const here = atom({ plugin: 'agent-comic', key: 'here' } as const, null as string | null)
const cameFrom = atom({ plugin: 'agent-comic', key: 'cameFrom' } as const, null as ComicSide | null)
const ring = atom({ plugin: 'agent-comic', key: 'places' } as const, [HUB] as ComicStop[])

/** When each place last said it was drawing. */
const aliveAt = new Map<string, number>()

/**
 * Tells the places what the band is doing; the comic itself never reads it. `isWorking`: a turn
 * (or the answer to a pat) is under way.
 */
export async function syncState($: EngineInterface, isWorking: () => boolean) {
  const isOn = await read($, enabled)
  const isStaying = await read($, lingering)
  const state: ComicState = !isOn ? 'hidden'
    : isWorking() ? 'working'
    : isStaying ? 'wrapping'
    : settings.showWhenIdle ? 'idle' : 'hidden'
  // read as stored, not with the atom's initial: other plugins see only what was written
  if ((await $.state.get({ plugin: 'agent-comic', key: 'state' })).value !== state) await update($, bandState, () => state)
}

export async function isEnabled($: EngineInterface): Promise<boolean> {
  return read($, enabled)
}

export async function setEnabled($: EngineInterface, isOn: boolean) {
  await update($, enabled, () => isOn)
}

export async function isLingering($: EngineInterface): Promise<boolean> {
  return read($, lingering)
}

export async function setLingering($: EngineInterface, isOn: boolean) {
  await update($, lingering, () => isOn)
}

/** The ring of stops, the hub first. */
export async function stops($: EngineInterface): Promise<ComicStop[]> {
  return read($, ring)
}

/** Where Claude is between turns: null for the hub, else a place's id. */
export async function whereNow($: EngineInterface): Promise<string | null> {
  return read($, here)
}

/** The signs from where he is now. */
export async function routeNow($: EngineInterface) {
  return routeOf(await read($, ring), await read($, here))
}

/** Whether `id` is a place on the ring. */
async function isOnRing($: EngineInterface, id: string): Promise<boolean> {
  return (await read($, ring)).some(s => s.id === id)
}

/** A place signs on (or is renamed). */
export async function addPlace($: EngineInterface, place: ComicPlace) {
  await update($, ring, r => withPlace(r, place))
}

/** A place signs off; Claude comes home to the hub if he was there. */
export async function removePlace($: EngineInterface, id: string) {
  await update($, ring, r => withoutPlace(r, id))
  aliveAt.delete(id)
  if ((await read($, here)) === id) await goTo($, null, null)
}

/** A place says it is still drawing; one the ring lost (the comic reloaded) is added back. */
export async function placeAlive($: EngineInterface, place: ComicPlace) {
  if (!(await isOnRing($, place.id))) await addPlace($, place)
  aliveAt.set(place.id, await $.clock.now())
}

/** Claude goes to a place on the ring (null: the hub), in from side `from`; an id not on it is ignored. */
export async function goTo($: EngineInterface, id: string | null, from: ComicSide | null) {
  if (id !== null && !(await isOnRing($, id))) return
  if (id !== null) aliveAt.set(id, await $.clock.now())
  // the side first, so the place reads it as it takes over
  await update($, cameFrom, () => from)
  await update($, here, () => id)
}

/** Follows the sign on side `dir`, if there is one. */
export async function stepTo($: EngineInterface, dir: ComicSide) {
  const route = await routeNow($)
  const to = dir === -1 ? route.left : route.right
  if (to) await goTo($, to.id, enteringFrom(dir))
}

/** A place that stopped drawing (it failed, or was turned off) sends Claude home to the hub. */
export async function checkPlace($: EngineInterface) {
  const id = await read($, here)
  if (id === null) return
  if (!(await isOnRing($, id))) return goTo($, null, null)
  const now = await $.clock.now()
  const last = aliveAt.get(id)
  // it draws only while the band is idle: until then, and on the way in, it has its grace
  if ((await read($, bandState)) !== 'idle' || last === undefined) return void aliveAt.set(id, now)
  if (now - last > ALIVE_MS) await goTo($, null, null)
}
