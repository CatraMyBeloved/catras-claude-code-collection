import { expect, test } from 'claude-code/testing'

import { CLOUD, DOOR, HUB_ART, HUB_KINDS, HUB_LOOK, RAIN, RAIN_CLOUD } from './hubart'
import * as h from './hubart'

const check = (rows: readonly string[], palette: Record<string, number>) => {
  const w = rows[0]!.length
  for (const r of rows) {
    expect(r.length).toBe(w)
    for (const ch of r) if (ch !== '.') expect(ch in palette).toBe(true)
  }
  return w
}

test('every keepsake is at most 7x7 with a full palette', () => {
  for (const k of HUB_KINDS) {
    const art = HUB_ART[k]
    expect(check(art.rows, art.palette) <= 7).toBe(true)
    expect(art.rows.length <= 7).toBe(true)
  }
})

test('the door is 7x10 in both frames', () => {
  expect(check(DOOR.closed, DOOR.palette)).toBe(7)
  expect(check(DOOR.open, DOOR.palette)).toBe(7)
  expect(DOOR.closed.length).toBe(10)
  expect(DOOR.open.length).toBe(10)
})

test('clouds are 3 tall and about 10 wide, the hub look is its own', () => {
  for (const c of [CLOUD, RAIN_CLOUD]) {
    expect(c.rows.length).toBe(3)
    const w = check(c.rows, c.palette)
    expect(w >= 9 && w <= 11).toBe(true)
  }
  expect(typeof RAIN).toBe('number')
  expect(HUB_LOOK.sky).toBe('sun')
})

test('garden art: flowers, can, looks', () => {
  const { FLOWER_STAGES, flowerPalette, FLOWER_COLORS, WATERING_CAN, GARDEN_LOOK } = h
  expect(FLOWER_STAGES.length).toBe(3)
  const pal = flowerPalette(FLOWER_COLORS[0]![0], FLOWER_COLORS[0]![1])
  for (const s of FLOWER_STAGES) {
    expect(check(s, pal)).toBe(5)
    expect(s.length <= 7).toBe(true)
  }
  expect(FLOWER_COLORS.length >= 5).toBe(true)
  expect(check(WATERING_CAN.rows, WATERING_CAN.palette)).toBe(5)
  expect(WATERING_CAN.rows.length).toBe(4)
  expect(GARDEN_LOOK.sky).toBe('sun')
})

test('den art: couch, tv, bed, lying claude', () => {
  const wb = check(h.COUCH_BACK.rows, h.COUCH_BACK.palette)
  const wf = check(h.COUCH_FRONT.rows, h.COUCH_FRONT.palette)
  expect(wb).toBe(wf)
  expect(wb >= 15 && wb <= 17).toBe(true)
  expect(h.COUCH_BACK.rows.length <= 6).toBe(true)
  expect(h.COUCH_FRONT.rows.length >= 2 && h.COUCH_FRONT.rows.length <= 3).toBe(true)
  const wt = check(h.TV.rows, h.TV.palette)
  expect(wt >= 9 && wt <= 11).toBe(true)
  expect(h.TV.rows.length >= 8 && h.TV.rows.length <= 9).toBe(true)
  const s = h.TV_SCREEN
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) expect(h.TV.rows[y]![x]).toBe('z')
  const wbed = check(h.BED.rows, h.BED.palette)
  expect(wbed >= 15 && wbed <= 17).toBe(true)
  expect(h.BED.rows.length >= 4 && h.BED.rows.length <= 5).toBe(true)
  expect(check(h.BED_OVER.rows, h.BED_OVER.palette)).toBe(wbed)
  expect(h.BED_HEAD_X >= 0 && h.BED_HEAD_X < wbed).toBe(true)
  const lp = { h: 1, O: 2, s: 3, E: 4 }
  for (const e of ['open', 'shut'] as const) {
    const l = h.claudeLying(e)
    const w = check(l, lp)
    expect(w >= 11 && w <= 13).toBe(true)
    expect(l.length >= 3 && l.length <= 4).toBe(true)
  }
  expect(h.DEN_LOOK.sky).toBe('none')
  expect(h.DEN_LOOK.far.kind).toBe('shelves')
})
