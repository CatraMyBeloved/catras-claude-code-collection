// The stage on screen. The terminal draws the band as a Raster, blitted every frame. The desktop app and
// VS Code draw no Raster: there the band is an SVG that plays a chunk of frames by itself. Once a
// chunk, the stage is stepped through the next one and the band redrawn with it, so the stage leads
// the clock by up to a chunk and what happens shows up to that much later than in the terminal.

import type { EngineInterface } from 'claude-code'

import type { Canvas } from './canvas'
import { stage } from './runtime'
import { fitChunk } from './svg'

const FRAME_MS = 50
const CHUNK_MS = 1000
const SVG_MODE_KEY = 'svgMode'
/** The Raster's key, for blits. */
export const RASTER_KEY = 'stage'

/** 'image' draws the SVG as a picture; 'frame' in a sandboxed frame (the SMIL route the API documents). */
export type SvgMode = 'image' | 'frame'

type Mount = { requestId: string; columns: number; rows: number }

let terminal: Mount | null = null
let isBlitting = false
let desktop: Mount | null = null
let desktopSvg: string | null = null
let desktopSize = ''
let svgMode: SvgMode = 'image'

/** Starts the clocks that draw the band, and reads back how the desktop draws it. */
export async function startBand($: EngineInterface) {
  $.clock.every(FRAME_MS, () => drawFrame($))
  $.clock.every(CHUNK_MS, () => drawChunk($))
  const stored = await $.store.get(SVG_MODE_KEY)
  if (stored === 'image' || stored === 'frame') svgMode = stored
}

export function getSvgMode(): SvgMode {
  return svgMode
}

export async function setSvgMode($: EngineInterface, mode: SvgMode) {
  svgMode = mode
  await $.store.set(SVG_MODE_KEY, mode)
}

/** The terminal shows the band at this size: the cells of the frame now. */
export function terminalCells(requestId: string, columns: number, rows: number): string {
  terminal = { requestId, columns, rows }
  return stage.frame(columns, rows)
}

/** The desktop shows the band at this size: the chunk of frames for it, built afresh when the size changed. */
export function desktopChunk(requestId: string, columns: number, rows: number): string {
  desktop = { requestId, columns, rows }
  const size = `${columns}x${rows}`
  if (!desktopSvg || size !== desktopSize) {
    desktopSize = size
    buildChunk()
  }
  return desktopSvg!
}

/** The surface shows something else: its drawing stops. */
export function hideBand(surface: string) {
  if (surface === 'terminal') terminal = null
  else {
    desktop = null
    desktopSvg = null
  }
}

/** Every frame: the stage steps to now, and the terminal's band is blitted. */
function drawFrame($: EngineInterface) {
  // while the desktop draws the band, the stage runs ahead of the clock in chunks: never step it back
  if (desktop && !terminal) return
  stage.step(Date.now())
  if (!terminal || isBlitting) return
  const { requestId, columns, rows } = terminal
  isBlitting = true
  $.ui.blit({ requestId, key: RASTER_KEY, cells: stage.frame(columns, rows) })
    .catch(() => undefined)
    .finally(() => {
      isBlitting = false
    })
}

/** Every chunk: the desktop's next chunk is built and the band redrawn with it. */
function drawChunk($: EngineInterface) {
  if (!desktop || terminal) return
  buildChunk()
  $.ui.invalidate('ui.render')
}

/** Steps the stage through the next chunk and makes its frames one SVG. */
function buildChunk() {
  if (!desktop) return
  const { columns, rows } = desktop
  const start = Math.max(Date.now(), stage.time + FRAME_MS)
  const frames: Canvas[] = []
  for (let t = start; t < start + CHUNK_MS; t += FRAME_MS) {
    stage.step(t)
    frames.push(stage.frameCanvas(columns, rows))
  }
  desktopSvg = fitChunk(frames, FRAME_MS).svg
}
