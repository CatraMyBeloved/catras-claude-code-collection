import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On, RenderElement, RenderPropsOf } from 'claude-code'

// A stand-in for agent-comic: $.comic and the state a place reads, nothing else. Its command
// `fake-comic <here> <state> [cameFrom]` sets the scene; `fake-comic-log` says what was called.
const fakeComic: Plugin = {
  name: 'agent-comic',
  register(on) {
    const calls: string[] = []
    on('engine.create', async ($, e, next) => {
      const built = await next(e)
      const stop = { id: null, name: 'Hub' }
      const comic = {
        version: async () => 1,
        addPlace: async () => undefined,
        removePlace: async () => undefined,
        places: async () => [stop],
        route: async () => ({ left: stop, right: null }),
        go: async () => undefined,
        step: async () => undefined,
        alive: async () => undefined,
        kit: async () => ({
          claude: { stand: ['O'], blink: ['O'], happy: ['O'], asleep: ['O'], wave: ['O'], walk: [['O'], ['O'], ['O'], ['O']], palette: { O: 0xd97757 } },
          hats: {},
          sign: { fg: 0xffffff, bg: 0x733e39, border: 0xe4a672 },
          palette: { moss: 1, leaf: 2, navy: 3, sky: 4, white: 5, wood: 6, silver: 7, red: 8, yellow: 9 },
        }),
      }
      return { ...built, comic }
    })
    on('comic.addPlace', async ($, e, next) => {
      calls.push(`addPlace ${JSON.stringify(e)}`)
      return next(e)
    })
    on('comic.alive', async ($, e, next) => {
      calls.push(`alive ${JSON.stringify(e)}`)
      return next(e)
    })
    on('comic.step', async ($, e, next) => {
      calls.push(`step ${JSON.stringify(e)}`)
      return next(e)
    })
    on('command.run', { command: 'fake-comic' }, async ($, e) => {
      const [here, state, from] = e.args.split(' ')
      await $.state.set({ plugin: 'agent-comic', key: 'here' }, here === 'hub' ? null : here!)
      await $.state.set({ plugin: 'agent-comic', key: 'state' }, state as 'idle')
      await $.state.set({ plugin: 'agent-comic', key: 'cameFrom' }, from ? (Number(from) as -1 | 1) : null)
      return { text: 'ok' }
    })
    on('command.run', { command: 'fake-comic-log' }, async () => ({ text: calls.join('\n') }))
  },
}

const band = { hasSurvey: false, isWorking: false, maxRows: 14, bodyColumns: 90, scroll: { bodyRows: 13, offset: 0, rows: 0 }, view: {} } as unknown as RenderPropsOf['AbovePrompt']

async function session($: Engine, on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, 'engine') as RenderElement
  })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const command = async (command: string, args = '') =>
    ((await $.command.run({ command, args } as unknown as Parameters<Engine['command']['run']>[0])) as { text: string }).text
  return { clock, command }
}

async function drawn($: Engine) {
  const mounted = await $.ui.mount({ plugin: 'pond-place', surface: 'terminal', component: 'AbovePrompt', props: band })
  const isPond = (await mounted.find({ key: 'pond' })) != null
  return { isPond, mounted }
}

test('the pond signs on, and draws only while it is here and the band is idle', { plugins: [fakeComic] }, async ($, on) => {
  const s = await session($, on)
  expect(await s.command('fake-comic-log')).toContain('addPlace {"id":"pond-place","name":"Pond"}')

  await s.command('fake-comic', 'hub idle')
  let d = await drawn($)
  expect(d.isPond).toBe(false)
  await d.mounted.unmount()

  await s.command('fake-comic', 'pond-place working')
  d = await drawn($)
  expect(d.isPond).toBe(false)
  await d.mounted.unmount()

  await s.command('fake-comic', 'pond-place idle -1')
  d = await drawn($)
  expect(d.isPond).toBe(true)
  // while it draws it says so each second, and its sign leads back to the hub
  await s.clock.advance(2000)
  expect(await s.command('fake-comic-log')).toContain('alive')
  await $.ui.press({ plugin: 'pond-place', key: 'pond-left' })
  expect(await s.command('fake-comic-log')).toContain('step {"dir":-1}')
  await d.mounted.unmount()
})

test('without agent-comic the pond stays out of the way', async ($, on) => {
  await session($, on)
  const d = await drawn($)
  expect(d.isPond).toBe(false)
  await d.mounted.unmount()
})
