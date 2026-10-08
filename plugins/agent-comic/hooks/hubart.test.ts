import { expect, test } from 'claude-code/testing'

import { CLOUD, DOOR, HUB_ART, HUB_KINDS, HUB_LOOK, RAIN, RAIN_CLOUD } from './hubart'

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
