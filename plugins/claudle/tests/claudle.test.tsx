import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { gameOf, levelFor, parseJson, pointsFor, ratingDelta, titleFor, toPuzzle } from '../hooks/games'
import type { Profile } from '../types'

const PANE_PROPS = {
  title: 'Claudle',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const WHAT_PRINTS = {
  title: 'Coercion Confusion',
  prompt: 'What does this print?',
  code: 'console.log([] + {})',
  language: 'javascript',
  options: ['[object Object]', 'undefined', '0', 'NaN'],
  answer: 0,
  explanation: 'Both sides become strings.',
  quip: 'JavaScript: the language that says yes to everything.',
}
const SPOT_THE_BUG = {
  title: 'Fencepost Follies',
  prompt: 'Sums an array.',
  code: 'function sum(xs) {\n  let t = 0\n  for (let i = 0; i <= xs.length; i++) t += xs[i]\n  return t\n}',
  language: 'javascript',
  bugLine: 3,
  bug: 'The loop uses <= and reads past the end; use <.',
  explanation: 'Off-by-one errors live at loop boundaries.',
  quip: 'NaN: not a number, not a vibe.',
}

/** The engine beneath the plugin: a store in memory and a scripted model. */
function engine(on: On, replies: (prompt: string) => string) {
  const stored: Record<string, unknown> = {}
  const prompts: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('store.get', (_$, e) => ({ value: stored[e.key] }))
  on('store.set', (_$, e) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)

    return { value: { isAnswered: true, text: replies(e.prompt), usage: USAGE } }
  })

  return { stored, prompts }
}

const scripted = (prompt: string) =>
  prompt.startsWith('GRADE')
    ? '```json\n{"score": 90, "verdict": "Spotted it."}\n```'
    : prompt.includes('GAME: Spot the Bug')
      ? JSON.stringify(SPOT_THE_BUG)
      : JSON.stringify(WHAT_PRINTS)

async function openPane($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.session.start({ cwd: 'C:/projects', surface, isInteractive: true })

  return $.ui.mount({ plugin: 'claudle', surface, component: 'Pane', requestId: 'claudle', props: PANE_PROPS })
}

test('a generated round keeps its right answer through the shuffle', () => {
  for (let seed = 0; seed < 20; seed++) {
    let n = seed
    const random = () => (n = (n * 9301 + 49297) % 233280) / 233280
    const puzzle = toPuzzle(gameOf('what-prints'), 'JavaScript', 3, WHAT_PRINTS, random)!
    expect(puzzle.options![puzzle.answer!]).toBe('[object Object]')
  }
})

test('unusable rounds are rejected', () => {
  expect(toPuzzle(gameOf('what-prints'), 'JS', 3, { ...WHAT_PRINTS, answer: 7 })).toBeUndefined()
  expect(toPuzzle(gameOf('what-prints'), 'JS', 3, { ...WHAT_PRINTS, options: ['a', 'a', 'b', 'c'] })).toBeUndefined()
  expect(toPuzzle(gameOf('spot-the-bug'), 'JS', 3, { ...SPOT_THE_BUG, bugLine: 40 })).toBeUndefined()
  expect(toPuzzle(gameOf('review-court'), 'JS', 3, { ...WHAT_PRINTS, answer: 2 })?.options).toEqual([
    'Valid',
    'Nitpick',
    'Wrong',
  ])
  expect(parseJson('Sure! {"a": 1} hope that helps')).toEqual({ a: 1 })
  expect(parseJson('no json here')).toBeUndefined()
})

test('ratings, levels, points and titles move sensibly', () => {
  expect(levelFor(1000)).toBe(3)
  expect(levelFor(5000)).toBe(10)
  expect(ratingDelta(1000, 3, 100)).toBeGreaterThan(0)
  expect(ratingDelta(1000, 3, 0)).toBeLessThan(0)
  expect(ratingDelta(1000, 8, 100)).toBeGreaterThan(ratingDelta(1000, 2, 100))
  expect(pointsFor(5, 100, 0)).toBe(50)
  expect(pointsFor(5, 100, 5)).toBe(75)
  expect(pointsFor(5, 20, 5)).toBe(0)
  expect(titleFor(0)).toBe('Fresh Intern')
  expect(titleFor(350)).toBe('Off-By-One Survivor')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a choice round: pick the right answer, earn XP (${surface})`, async ($, on) => {
    const { stored } = engine(on, scripted)
    const ui = await openPane($, surface)

    await ui.press({ key: 'game:what-prints' })
    const options = await ui.findAll({ type: 'Button' })
    const right = options.find(b => b.text?.includes('[object Object]'))
    expect(right?.key).toMatch(/^opt:/)

    await ui.press({ key: right!.key! })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('✓ CORRECT')
    expect(drawn).toContain('JavaScript: the language that says yes to everything.')
    const p = stored.profile as Profile
    expect(p.played).toBe(1)
    expect(p.correct).toBe(1)
    expect(p.xp).toBeGreaterThan(0)
    expect(p.recent['what-prints']).toEqual(['Coercion Confusion'])
  })
}

test('a wrong pick shows the answer and resets the streak', async ($, on) => {
  const { stored } = engine(on, scripted)
  const ui = await openPane($)
  await ui.press({ key: 'game:what-prints' })
  const wrong = (await ui.findAll({ type: 'Button' })).find(b => b.text?.includes('NaN'))
  await ui.press({ key: wrong!.key! })

  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('✗ NOT QUITE')
  expect(drawn).toContain('[object Object]')
  expect((stored.profile as Profile).streak).toBe(0)
  expect((stored.profile as Profile).xp).toBe(0)
})

test('Spot the Bug: a typed answer is graded by the model', async ($, on) => {
  const { stored, prompts } = engine(on, scripted)
  const ui = await openPane($)
  await ui.press({ key: 'game:spot-the-bug' })
  await ui.input({ key: 'answer', text: 'line 3, <= should be <' })

  expect(prompts.find(p => p.startsWith('GRADE'))).toContain('line 3, <= should be <')
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Spotted it.')
  expect(drawn).toContain('90/100')
  expect((stored.profile as Profile).correct).toBe(1)
})

test('the pane draws the pixel header and game icons on the terminal, text elsewhere', async ($, on) => {
  engine(on, scripted)
  const terminal = await openPane($, 'terminal')
  expect(await terminal.find({ key: 'header' })).toBeDefined()
  expect(await terminal.find({ key: 'icon:big-o' })).toBeDefined()
  const desktop = await $.ui.mount({ plugin: 'claudle', surface: 'desktop', component: 'Pane', requestId: 'claudle', props: PANE_PROPS })
  expect(await desktop.find({ key: 'header' })).toBeUndefined()
  expect(JSON.stringify(await desktop.drawn())).toContain('CLAUDLE')
})

test('the next round was prefetched while the first was played', async ($, on) => {
  const { prompts } = engine(on, scripted)
  const ui = await openPane($)
  await ui.press({ key: 'game:what-prints' })
  expect(prompts.length).toBe(2)
  const right = (await ui.findAll({ type: 'Button' })).find(b => b.text?.includes('[object Object]'))
  await ui.press({ key: right!.key! })
  await ui.press({ key: 'next' })
  expect(JSON.stringify(await ui.drawn())).toContain('What does this print?')
  // the second round came from the prefetch; only its own prefetch is new
  expect(prompts.length).toBe(3)
})

test('garbage from the model ends in a retry screen, not a crash', async ($, on) => {
  engine(on, () => 'I would rather not.')
  const ui = await openPane($)
  await ui.press({ key: 'game:big-o' })
  expect(await ui.find({ key: 'retry' })).toBeDefined()
})

test('/claudle topics and stats', async ($, on) => {
  const { stored } = engine(on, scripted)
  await $.session.start({ cwd: 'C:/projects', surface: 'terminal', isInteractive: true })
  const run = (args: string) =>
    $.command.run({
      command: 'claudle',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

  expect((await run('topics Rust, Go')).text).toBe('Claudle topics: Rust, Go')
  expect(stored.topics).toEqual(['Rust', 'Go'])
  expect((await run('stats')).text).toContain('Fresh Intern · 0 XP')
})

test('every text row of a menu card starts its game', async ($, on) => {
  engine(on, scripted)
  const ui = await openPane($)
  await ui.press({ key: 'game:what-prints:about' })
  expect(JSON.stringify(await ui.drawn())).toContain('What does this print?')
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'game:what-prints:meta' })
  expect(JSON.stringify(await ui.drawn())).toContain('What does this print?')
})

test('giving up reveals the answer and counts as a miss', async ($, on) => {
  const { stored } = engine(on, scripted)
  const ui = await openPane($)
  await ui.press({ key: 'game:spot-the-bug' })
  await ui.press({ key: 'giveup' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('You gave up')
  expect(drawn).toContain('Line ')
  expect((stored.profile as Profile).played).toBe(1)
  expect((stored.profile as Profile).correct).toBe(0)
  expect((stored.profile as Profile).games['spot-the-bug']).toEqual({ played: 1, correct: 0 })
})

test('topics toggle in the pane, never down to none', async ($, on) => {
  const { stored } = engine(on, scripted)
  const ui = await openPane($)
  await ui.press({ key: 'topics' })
  await ui.press({ key: 'topic:Rust' })
  expect(stored.topics).toContain('Rust')
  for (const t of ['JavaScript', 'TypeScript', 'Python', 'SQL', 'Git', 'Shell']) await ui.press({ key: `topic:${t}` })
  expect(stored.topics).toEqual(['Rust'])
  await ui.press({ key: 'topic:Rust' })
  expect(stored.topics).toEqual(['Rust'])
  await ui.press({ key: 'done' })
  expect(await ui.find({ key: 'surprise' })).toBeDefined()
})

test('the progress view shows games and topic levels', async ($, on) => {
  engine(on, scripted)
  const ui = await openPane($)
  await ui.press({ key: 'game:what-prints' })
  const right = (await ui.findAll({ type: 'Button' })).find(b => b.text?.includes('[object Object]'))
  await ui.press({ key: right!.key! })
  await ui.press({ key: 'other' })
  await ui.press({ key: 'stats' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('100% of 1')
  expect(drawn).toContain('not played yet')
  expect(drawn).toMatch(/level \d · rating \d+/)
})

test('an unfocused pane says how to get the keyboard', async ($, on) => {
  engine(on, scripted)
  await $.session.start({ cwd: 'C:/projects', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'claudle',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'claudle',
    props: { ...PANE_PROPS, isFocused: false },
  })
  expect(JSON.stringify(await ui.drawn())).toContain('ctrl+x tab')
})

const withTutor = (prompt: string) =>
  prompt.startsWith('ROUND:') ? 'Look closely at **what `map` passes** to its callback.' : scripted(prompt)

test('before answering, the tutor gets the hints-only rules', async ($, on) => {
  const { prompts } = engine(on, withTutor)
  const ui = await openPane($)
  await ui.press({ key: 'game:what-prints' })
  await ui.press({ key: 'hint' })
  await ui.press({ key: 'quick:Give me a hint' })

  const asked = prompts.find(p => p.startsWith('ROUND:'))!
  expect(asked).toContain('THE PLAYER HAS NOT ANSWERED YET')
  expect(asked).toContain("PLAYER'S QUESTION: Give me a hint")
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('what `map` passes')
  expect(drawn).toContain('hints only until you answer')
  // the round is still open
  expect(await ui.find({ key: 'opt:0' })).toBeDefined()
})

test('after answering, the tutor sees the pick, the answer and the conversation', async ($, on) => {
  const { prompts } = engine(on, withTutor)
  const ui = await openPane($)
  await ui.press({ key: 'game:what-prints' })
  const wrong = (await ui.findAll({ type: 'Button' })).find(b => b.text?.includes('NaN'))
  await ui.press({ key: wrong!.key! })

  expect(await ui.find({ key: 'quick:Why was my answer wrong?' })).toBeDefined()
  await ui.input({ key: 'ask:0', text: 'why not NaN?' })
  await ui.input({ key: 'ask:2', text: 'and with Number instead?' })

  const asks = prompts.filter(p => p.startsWith('ROUND:'))
  expect(asks).toHaveLength(2)
  expect(asks[0]).toContain('The player picked')
  expect(asks[0]).toContain('NaN')
  expect(asks[0]).toContain('Correct answer:')
  expect(asks[0]).not.toContain('NOT ANSWERED')
  expect(asks[1]).toContain('Player: why not NaN?')
  expect(asks[1]).toContain("PLAYER'S QUESTION: and with Number instead?")
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('› why not NaN?')
  expect(drawn).toContain('› and with Number instead?')
})

test('a new round starts a fresh conversation', async ($, on) => {
  engine(on, withTutor)
  const ui = await openPane($)
  await ui.press({ key: 'game:what-prints' })
  await ui.press({ key: 'giveup' })
  await ui.input({ key: 'ask:0', text: 'explain please' })
  expect(JSON.stringify(await ui.drawn())).toContain('› explain please')
  await ui.press({ key: 'next' })
  await ui.press({ key: 'giveup' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('› explain please')
  expect(await ui.find({ key: 'ask:0' })).toBeDefined()
})
