// What the parts of the comic share in this load of the module: the stage, and the /config settings.

import type { PluginOptions } from 'claude-code'

import { PACES } from './beats'
import { Stage } from './stage'

/**
 * Who stages the scenes: the model stages every one (full); the session's world, each turn's opening
 * and its wrap-up, with canned scenes between (hybrid); or nobody, everything canned (off).
 */
export type DirectorMode = 'full' | 'hybrid' | 'off'

export type Settings = { model: 'sonnet' | 'haiku'; pace: keyof typeof PACES; showWhenIdle: boolean; director: DirectorMode }

export const settings: Settings = { model: 'sonnet', pace: 'calm', showWhenIdle: true, director: 'hybrid' }

export const stage = new Stage()

/** Takes /config's values as the module (re)loads; anything unexpected keeps the default. */
export function applySettings(options: PluginOptions) {
  settings.model = options.model === 'haiku' ? 'haiku' : 'sonnet'
  settings.pace = options.pace === 'normal' || options.pace === 'lively' ? options.pace : 'calm'
  settings.showWhenIdle = options.showWhenIdle !== false
  settings.director = options.director === 'full' || options.director === 'off' ? options.director : 'hybrid'
  stage.pace = PACES[settings.pace]
}
