// Dry run of the director: feeds a simulated session through the real prompt and
// variety notes, scene after scene, via `claude -p` on Sonnet. Prints each scene briefly.
//   bun dev/director-trial.ts
import { SYSTEM, buildPrompt, varietyNotes } from '../hooks/director'
import { parseScene } from '../hooks/scene'
import type { Scene } from '../hooks/scene'
import { Stage } from '../hooks/stage'

const session = [
  ['read src/auth/login.ts -> export async function login(user, password) {', 'read src/auth/session.ts -> const SESSION_TTL = 3600'],
  ['searched for "SESSION_TTL" -> 3 matches in 2 files', 'read src/config.ts -> export const config = {'],
  ['ran `npm test` -> FAILED: 2 failing: session expires too early', 'the agent said: The TTL is in seconds here but milliseconds in config.ts.'],
  ['edited src/auth/session.ts', 'ran `npm test` -> 48 passing'],
]
const log: string[] = []
const recent: Scene[] = []
// one turn: the first scene sets up the world, the stage plays each scene so later ones see its changes
const stage = new Stage(() => 0.5)
stage.frame(100, 10)
let clock = 1_000_000
for (const batch of session) {
  log.push(...batch)
  const world = recent.length ? stage.world() : undefined
  const prompt = buildPrompt({ goal: 'why do sessions expire early?', log, fresh: batch.length, previous: recent.at(-1) ?? null, finished: false, world, variety: varietyNotes(recent, Math.random, recent.length ? [recent[0]!.setting] : [], recent[0]?.setting) })
  const run = Bun.spawnSync(['claude', '-p', '--model', 'sonnet', '--system-prompt', SYSTEM, prompt])
  const scene = parseScene(run.stdout.toString(), world)
  if ('error' in scene) { console.log('unusable:', scene.error, run.stderr.toString().slice(0, 200)); continue }
  recent.push(scene)
  stage.queue(scene)
  for (let k = 0; k < 900; k++) { clock += 50; stage.step(clock); stage.frame(100, 10) }
  const props = scene.props.map(p => p.kind + (p.label ? `(${p.label})` : '')).join(', ')
  console.log(`\n[${scene.setting}, ${scene.mood}, hat: ${stage.world().hat}] props: ${props}`)
  console.log('  ' + scene.beats.map(b => b.do + ('text' in b ? `: "${b.text}"` : 'mood' in b ? `:${b.mood}` : 'at' in b && b.at ? `@${b.at}` : '')).join(' | '))
}
