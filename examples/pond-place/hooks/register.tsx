// An example place for agent-comic: a pond where Claude goes fishing between turns.
// It shows everything a place does (EXTENDING.md in agent-comic says why):
//   1. signs on at session start, with $.comic.addPlace
//   2. draws the band only while the comic's `here` is this place and its `state` is idle
//   3. says it is alive each second while it draws, or Claude is sent home
//   4. draws signs to its neighbours (route) and follows them (step) on a/d
//   5. lets Claude walk in from the side he came from (cameFrom)
// Without agent-comic it stays out of the way.

import type { Register } from 'claude-code'

import { draw } from './pond'
import type { Arrival, Kit, Stop } from './pond'

const PLACE = { id: 'pond-place', name: 'Pond' }
const KEY = 'pond'
const LEFT = 'pond-left'
const RIGHT = 'pond-right'
const FRAME_MS = 100
const MIN_ROWS = 6
const MAX_ROWS = 10

let kit: Kit | null = null // the comic's art, fetched once it is there
let mount: { requestId: string; columns: number; rows: number } | null = null
let signs: { left: Stop | null; right: Stop | null } = { left: null, right: null }
let arrival: Arrival | null = null
let isBlitting = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.comic.addPlace(PLACE)
      kit = await $.comic.kit()
    } catch {
      kit = null // no comic: no world to be a place in
    }
    $.clock.every(FRAME_MS, async () => {
      if (!mount || isBlitting || !kit) return
      const { requestId, columns, rows } = mount
      isBlitting = true
      await $.ui.blit({ requestId, key: KEY, cells: draw(kit, columns, rows, await $.clock.now(), arrival, signs) }).catch(() => undefined)
      isBlitting = false
    })
    // while it draws, the pond tells the comic so; silent, Claude would be sent home
    $.clock.every(1000, async () => {
      if (mount) await $.comic.alive(PLACE).catch(() => undefined)
    })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // reading the comic's state here redraws the band whenever it changes
    const here = (await $.state.get({ plugin: 'agent-comic', key: 'here' })).value
    const state = (await $.state.get({ plugin: 'agent-comic', key: 'state' })).value
    await $.state.get({ plugin: 'agent-comic', key: 'places' }) // and when places come and go
    const rows = Math.min(MAX_ROWS, e.props.maxRows - 1)
    const isMine = here === PLACE.id && state === 'idle' && !e.props.isWorking
    if (!isMine || !kit || e.props.hasSurvey || rows < MIN_ROWS || e.surface !== 'terminal') {
      mount = null
      arrival = null
      return next(e)
    }
    const now = await $.clock.now()
    if (!arrival) arrival = { from: (await $.state.get({ plugin: 'agent-comic', key: 'cameFrom' })).value ?? null, at: now }
    signs = await $.comic.route()
    const columns = Math.max(20, Math.min(512, e.props.bodyColumns - 5))
    mount = { requestId: e.requestId, columns, rows }
    const { Box, Button, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Raster key={KEY} columns={columns} rows={rows} cells={draw(kit, columns, rows, now, arrival, signs)} />
        <Box flexDirection="column" paddingLeft={1}>
          {signs.left ? <Button key={LEFT} plain hotkey="a" onPress={() => undefined}>◂</Button> : null}
          {signs.right ? <Button key={RIGHT} plain hotkey="d" onPress={() => undefined}>▸</Button> : null}
        </Box>
      </Box>
    )
  })

  on('ui.press', { element: LEFT }, async $ => {
    await $.comic.step({ dir: -1 })
    return { element: LEFT }
  })

  on('ui.press', { element: RIGHT }, async $ => {
    await $.comic.step({ dir: 1 })
    return { element: RIGHT }
  })
}
