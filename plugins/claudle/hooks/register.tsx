import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Chat, GameId, Outcome, Profile, Puzzle, View } from '../types'
import { GAME_COLOR, header, headerRows, hex, ICON_COLUMNS, ICON_ROWS, iconCells, P } from './art'
import type { Mood, Scene } from './art'
import { headerSvg, iconSvg } from './svg'
import {
  emptyProfile,
  gameOf,
  GAMES,
  generationPrompt,
  gradingPrompt,
  levelFor,
  LOADING_LINES,
  parseJson,
  pointsFor,
  progressFor,
  ASK_AFTER,
  ASK_BEFORE,
  TUTOR_SYSTEM,
  tutorPrompt,
  TOPIC_PRESETS,
  ratingDelta,
  START_RATING,
  SYSTEM,
  titleFor,
  toPuzzle,
} from './games'

const PANE = 'claudle'
const TITLE = 'Claudle'
export const DEFAULT_TOPICS = ['JavaScript', 'TypeScript', 'Python', 'SQL', 'Git', 'Shell']

const view = atom({ plugin: 'claudle', key: 'view' } as const, { kind: 'menu' })
const profile = atom({ plugin: 'claudle', key: 'profile' } as const, emptyProfile())
const topics = atom({ plugin: 'claudle', key: 'topics' } as const, DEFAULT_TOPICS)
const agentDone = atom({ plugin: 'claudle', key: 'agentDone' } as const, false)
const chat = atom({ plugin: 'claudle', key: 'chat' } as const, { round: '', turns: [], isPending: false, isOpen: false })

const HEADER = 'header'
const ORANGE = 0xd97757
const { ink: INK, slate: SLATE, moss: MOSS, blood: BLOOD } = P

/** Where the animated header is drawn, while the pane shows it. */
let mount: { requestId: string; columns: number } | null = null
let isBlitting = false
/** What the header shows; the render hook keeps it in step with the view. */
let scene: Scene = { mood: 'idle', since: 0, title: '', xp: 0, progress: 0, nextAt: undefined, streak: 0 }
let sceneKey = ''

function setScene(now: View, p: Profile, isTutoring: boolean) {
  let mood: Mood =
    now.kind === 'menu' || now.kind === 'stats' || now.kind === 'topics'
      ? 'idle'
      : now.kind === 'loading'
        ? 'thinking'
        : now.kind === 'question'
          ? 'watching'
          : now.kind === 'grading'
            ? 'grading'
            : now.kind === 'error'
              ? 'confused'
              : now.outcome.score >= 50
                ? 'correct'
                : 'wrong'
  if (isTutoring) mood = 'grading'
  const key = `${mood}:${'puzzle' in now ? now.puzzle.title : ''}`
  const since = key === sceneKey ? scene.since : Date.now()
  sceneKey = key
  scene = { mood, since, title: titleFor(p.xp), xp: p.xp, streak: p.streak, ...progressFor(p.xp) }
}

function drawFrame($: EngineInterface) {
  if (!mount || isBlitting) return
  const { requestId, columns } = mount
  isBlitting = true
  $.ui
    .blit({ requestId, key: HEADER, cells: header(columns, scene, Date.now()) })
    .then(r => {
      if ('deny' in r && r.deny) mount = null
    })
    .catch(() => {
      mount = null
    })
    .finally(() => {
      isBlitting = false
    })
}

/** The quizmaster model, from the mod's settings. */
let model = 'sonnet'
/** The next round of each game, generated while the current one is played. */
const prefetched = new Map<GameId, Promise<Puzzle | undefined>>()
/** Bumped by every new round or trip to the menu, so a late reply is dropped. */
let roundId = 0

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

async function ask($: EngineInterface, prompt: string, maxTokens: number) {
  const reply = await $.model.complete({ model, system: SYSTEM, prompt, maxTokens, timeoutMs: 90_000 })

  return reply.isAnswered ? parseJson(reply.text) : undefined
}

async function generate($: EngineInterface, id: GameId): Promise<Puzzle | undefined> {
  const game = gameOf(id)
  const { ratings, recent } = await read($, profile)
  const topic = pick(await read($, topics))
  const level = levelFor(ratings[topic] ?? START_RATING)
  const prompt = generationPrompt(game, topic, level, recent[id] ?? [])
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ask($, prompt, 1500)
    const puzzle = raw && toPuzzle(game, topic, level, raw)
    if (puzzle) return { ...puzzle, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }
  }

  return undefined
}

function prefetch($: EngineInterface, id: GameId) {
  if (!prefetched.has(id)) prefetched.set(id, generate($, id).catch(() => undefined))
}

async function startRound($: EngineInterface, id: GameId) {
  const mine = ++roundId
  await update($, view, (): View => ({ kind: 'loading', game: id, line: pick(LOADING_LINES) }))
  const ready = prefetched.get(id)
  prefetched.delete(id)
  const puzzle = (await ready) ?? (await generate($, id).catch(() => undefined))
  if (mine !== roundId) return
  if (!puzzle) {
    await update($, view, (): View => ({
      kind: 'error',
      game: id,
      message: `The ${model} quizmaster didn't produce a usable round. Try again?`,
    }))

    return
  }
  await update($, view, (): View => ({ kind: 'question', puzzle }))
  prefetch($, id)
}

async function toMenu($: EngineInterface) {
  roundId++
  await update($, view, (): View => ({ kind: 'menu' }))
}

async function finish($: EngineInterface, puzzle: Puzzle, score: number, verdict: string, extra: Partial<Outcome>) {
  const before = await read($, profile)
  const rating = before.ratings[puzzle.topic] ?? START_RATING
  const delta = ratingDelta(rating, puzzle.level, score)
  const isWin = score >= 50
  const streak = isWin ? before.streak + 1 : 0
  const points = pointsFor(puzzle.level, score, before.streak)
  const after: Profile = {
    xp: before.xp + points,
    played: before.played + 1,
    correct: before.correct + (isWin ? 1 : 0),
    streak,
    bestStreak: Math.max(before.bestStreak, streak),
    games: {
      ...before.games,
      [puzzle.game]: {
        played: (before.games[puzzle.game]?.played ?? 0) + 1,
        correct: (before.games[puzzle.game]?.correct ?? 0) + (isWin ? 1 : 0),
      },
    },
    ratings: { ...before.ratings, [puzzle.topic]: rating + delta },
    recent: { ...before.recent, [puzzle.game]: [...(before.recent[puzzle.game] ?? []), puzzle.title].slice(-15) },
  }
  await update($, profile, () => after)
  await $.store.set('profile', after)
  if (titleFor(after.xp) !== titleFor(before.xp)) $.ui.toast(`Claudle: promoted to ${titleFor(after.xp)}!`)
  await update($, view, (): View => ({
    kind: 'feedback',
    puzzle,
    outcome: { score, verdict, points, ratingDelta: delta, ...extra },
  }))
}

async function answerChoice($: EngineInterface, picked: number) {
  const now = await read($, view)
  if (now.kind !== 'question' || now.puzzle.answer === undefined) return
  const isRight = picked === now.puzzle.answer
  await finish($, now.puzzle, isRight ? 100 : 0, isRight ? 'Correct!' : 'Nope.', { picked })
}

async function answerText($: EngineInterface, typed: string) {
  const now = await read($, view)
  if (now.kind !== 'question' || now.puzzle.game !== 'spot-the-bug' || typed.trim() === '') return
  const mine = roundId
  const { puzzle } = now
  await update($, view, (): View => ({ kind: 'grading', puzzle, typed }))
  const raw = await ask($, gradingPrompt(puzzle, typed), 400).catch(() => undefined)
  if (mine !== roundId) return
  const graded = Number(raw?.score)
  const score = Number.isFinite(graded) ? Math.min(100, Math.max(0, Math.round(graded))) : fallbackScore(puzzle, typed)
  const verdict =
    typeof raw?.verdict === 'string' ? raw.verdict : 'The judge fell asleep; scored on the line number alone.'
  await finish($, puzzle, score, verdict, { typed })
}

/** Reveals the answer; the round counts as a miss. */
async function giveUp($: EngineInterface) {
  const now = await read($, view)
  if (now.kind !== 'question') return
  roundId++
  await finish($, now.puzzle, 0, 'You gave up. Here is what was going on.', {})
}

async function toggleTopic($: EngineInterface, topic: string) {
  const list = await read($, topics)
  const next = list.includes(topic) ? list.filter(t => t !== topic) : [...list, topic]
  if (next.length === 0) {
    $.ui.toast('Claudle needs at least one topic.')

    return
  }
  await update($, topics, () => next)
  await $.store.set('topics', next)
  prefetched.clear()
}

async function show($: EngineInterface, kind: 'stats' | 'topics') {
  roundId++
  await update($, view, (): View => ({ kind }))
}

/** Which round a chat belongs to. */
function roundOf(puzzle: Puzzle): string {
  return puzzle.id ?? `${puzzle.game}:${puzzle.topic}:${puzzle.title}`
}

/** The chat for the round on screen: the stored one, or a fresh one when it was about another round. */
function chatFor(stored: Chat, puzzle: Puzzle): Chat {
  return stored.round === roundOf(puzzle) ? stored : { round: roundOf(puzzle), turns: [], isPending: false, isOpen: false }
}

async function openTutor($: EngineInterface) {
  const now = await read($, view)
  if (!('puzzle' in now)) return
  const { puzzle } = now
  await update($, chat, c => ({ ...chatFor(c, puzzle), isOpen: true }))
  await $.ui.focus({ requestId: PANE, key: askKey(chatFor(await read($, chat), puzzle)) }).catch(() => undefined)
}

/** The ask field's key changes with every question, so it comes back empty. */
function askKey(c: Chat): string {
  return `ask:${c.turns.length}`
}

async function askTutor($: EngineInterface, question: string) {
  const now = await read($, view)
  if (question.trim() === '' || !('puzzle' in now)) return
  const { puzzle } = now
  const before = chatFor(await read($, chat), puzzle)
  if (before.isPending) return
  const outcome = now.kind === 'feedback' ? now.outcome : undefined
  await update($, chat, (): Chat => ({
    ...before,
    isOpen: true,
    isPending: true,
    turns: [...before.turns, { who: 'you', text: question.trim() }],
  }))
  const reply = await $.model
    .complete({
      model,
      system: TUTOR_SYSTEM,
      prompt: tutorPrompt(puzzle, outcome, before.turns, question),
      maxTokens: 900,
      timeoutMs: 90_000,
    })
    .catch(() => undefined)
  const text = reply?.isAnswered
    ? reply.text.trim()
    : `I couldn't reach the tutor just now${reply && !reply.isAnswered ? ` (${reply.reason})` : ''}. Try asking again?`
  const after = await read($, chat)
  if (after.round !== roundOf(puzzle)) return
  await update($, chat, (c): Chat => ({ ...c, isPending: false, turns: [...c.turns, { who: 'claude', text }] }))
  await $.ui.focus({ requestId: PANE, key: askKey(await read($, chat)) }).catch(() => undefined)
}

/** When grading fails: the right line counts as a pass, nothing else does. */
export function fallbackScore(puzzle: Puzzle, typed: string): number {
  const line = typed.match(/\d+/)?.[0]

  return line !== undefined && Number(line) === puzzle.bugLine ? 60 : 0
}

const HELP = [
  '/claudle                 open the game pane',
  `/claudle play <game>     jump into a game (${GAMES.map(g => g.id).join(', ')})`,
  '/claudle answer <text>   answer a Spot the Bug round from the prompt',
  '/claudle topics a, b, c  set the topics rounds are drawn from',
  '/claudle stats           XP, accuracy, rating per topic',
  '/claudle reset           start over',
].join('\n')

export const register: Register = (on, options) => {
  model = typeof options.model === 'string' ? options.model : 'sonnet'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'claudle',
      description: 'Programming mini-games to play while Claude works',
      argumentHint: '[play <game> | answer <text> | topics <a, b, ...> | stats | reset]',
    })
    const storedProfile = (await $.store.get('profile')) as Profile | undefined
    const storedTopics = (await $.store.get('topics')) as string[] | undefined
    if (storedProfile) await update($, profile, () => ({ ...emptyProfile(), ...storedProfile }))
    if (storedTopics?.length) await update($, topics, () => storedTopics)
    $.clock.every(120, () => drawFrame($))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, agentDone, () => false)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await read($, view)
    if (now.kind !== 'menu' && now.kind !== 'stats' && now.kind !== 'topics' && !(await read($, agentDone))) {
      await update($, agentDone, () => true)
      $.ui.toast('Claude finished its turn. Your Claudle round will wait.')
    }

    return next(e)
  })

  on('command.run', { command: 'claudle' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const p = await read($, profile)

    if (verb === '' || verb === 'play') {
      const wanted = rest.join(' ').toLowerCase()
      const game = wanted ? GAMES.find(g => g.id.startsWith(wanted) || g.name.toLowerCase().startsWith(wanted)) : undefined
      if (wanted && !game) return { text: `No such game. Games: ${GAMES.map(g => g.id).join(', ')}` }
      await $.ui.open({ id: PANE, title: TITLE, focus: true })
      if (game) void startRound($, game.id)

      return { text: game ? `Claudle: ${game.name}.` : 'Claudle opened.' }
    }

    if (verb === 'answer') {
      const now = await read($, view)
      if (now.kind !== 'question' || now.puzzle.game !== 'spot-the-bug') return { text: 'No Spot the Bug round is waiting.' }
      void answerText($, rest.join(' '))

      return { text: 'Answer sent to the judge.' }
    }

    if (verb === 'topics') {
      const list = rest.join(' ').split(',').map(t => t.trim()).filter(Boolean)
      if (list.length === 0) return { text: `Topics: ${(await read($, topics)).join(', ')}` }
      await update($, topics, () => list)
      await $.store.set('topics', list)
      prefetched.clear()

      return { text: `Claudle topics: ${list.join(', ')}` }
    }

    if (verb === 'stats') {
      const ratings = Object.entries(p.ratings)
        .sort(([, a], [, b]) => b - a)
        .map(([t, r]) => `  ${t.padEnd(14)} ${r}  (level ${levelFor(r)})`)
      const accuracy = p.played ? Math.round((100 * p.correct) / p.played) : 0

      return {
        text: [
          `${titleFor(p.xp)} · ${p.xp} XP · ${p.played} played · ${accuracy}% right · best streak ${p.bestStreak}`,
          ...(ratings.length ? ratings : ['  no rated topics yet']),
        ].join('\n'),
      }
    }

    if (verb === 'reset') {
      await update($, profile, () => emptyProfile())
      await $.store.set('profile', emptyProfile())

      return { text: 'Claudle progress reset.' }
    }

    return { text: HELP }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Code } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    // only the terminal paints pixels; other surfaces draw a Raster as an empty box
    const Raster = e.surface === 'terminal' && 'Raster' in elements ? elements.Raster : undefined
    const Svg = !Raster && 'Svg' in elements ? elements.Svg : undefined
    const now: View = await read($, view)
    const p = await read($, profile)
    const isAgentDone = await read($, agentDone)
    const width = Math.max(24, e.props.bodyColumns)
    const isFocused = e.props.isFocused
    const storedChat = await read($, chat)
    const talk = 'puzzle' in now ? chatFor(storedChat, now.puzzle) : undefined
    setScene(now, p, talk?.isPending ?? false)
    const Markdown = 'Markdown' in elements ? elements.Markdown : undefined

    /** The Ask Claude box: the conversation, quick questions, and a field to type in. */
    const tutor = (puzzle: Puzzle, isAnswered: boolean) => {
      const c = talk ?? chatFor(storedChat, puzzle)
      const quick = isAnswered
        ? [...(now.kind === 'feedback' && now.outcome.score < 50 ? ['Why was my answer wrong?'] : []), ...ASK_AFTER]
        : ASK_BEFORE

      return (
        <Box borderStyle="round" borderColor={hex(ORANGE)} paddingX={1} flexDirection="column" gap={1}>
          <Text>
            <Text bold color={hex(ORANGE)}>
              Ask Claude
            </Text>
            <Text dimColor>{isAnswered ? '  learn the why behind it' : '  hints only until you answer'}</Text>
          </Text>
          {c.turns.map((t, i) =>
            t.who === 'you' ? (
              <Text key={`you:${i}`} color={hex(P.sand)} wrap="wrap">
                {`› ${t.text}`}
              </Text>
            ) : Markdown ? (
              <Markdown key={`claude:${i}`} text={t.text} />
            ) : (
              <Text key={`claude:${i}`} wrap="wrap">
                {t.text}
              </Text>
            ),
          )}
          {c.isPending ? (
            <Text dimColor italic>
              Claude is thinking it through…
            </Text>
          ) : (
            <Box columnGap={2} flexWrap="wrap">
              {quick.map(q => (
                <Button key={`quick:${q}`} plain dimColor label={`› ${q}`} onPress={() => void askTutor($, q)} />
              ))}
            </Box>
          )}
          {Input && !c.isPending ? (
            <Input
              key={askKey(c)}
              label="Ask"
              placeholder={isAnswered ? 'Why does map pass the index to parseInt?' : 'What should I look at first?'}
              submitLabel="Ask"
              onSubmit={(value: string) => void askTutor($, value)}
            />
          ) : null}
        </Box>
      )
    }

    // ── pieces every view shares ──
    let headerEl
    if (Raster) {
      const columns = Math.min(512, width)
      mount = { requestId: e.requestId, columns }
      headerEl = (
        <Raster key={HEADER} columns={columns} rows={headerRows(columns)} cells={header(columns, scene, Date.now())} />
      )
    } else if (Svg) {
      // the desktop: the same pixel art as an SVG that animates itself
      mount = null
      // an SVG scales to the pane: always the wide layout (big logo), shrunk to fit
      const columns = 88
      headerEl = (
        <Svg
          source={headerSvg(columns, scene, Date.now())}
          alt={`Claudle: ${titleFor(p.xp)}, ${p.xp} XP${p.streak > 1 ? `, streak ${p.streak}` : ''}`}
          isInteractive
        />
      )
    } else {
      mount = null
      headerEl = (
        <Box justifyContent="space-between">
          <Text bold color={hex(ORANGE)}>
            CLAUDLE <Text dimColor>{titleFor(p.xp)}</Text>
          </Text>
          <Text dimColor>
            {p.xp} XP{p.streak > 1 ? ` · x${p.streak} streak` : ''}
          </Text>
        </Box>
      )
    }
    const iconWidth = Raster || Svg ? ICON_COLUMNS : 1
    const icon = (id: GameId, key: string) =>
      Raster ? (
        <Raster key={key} columns={ICON_COLUMNS} rows={ICON_ROWS} cells={iconCells(id)} />
      ) : Svg ? (
        <Svg source={iconSvg(id)} alt={gameOf(id).name} width={48} height={36} />
      ) : (
        <Text color={hex(GAME_COLOR[id])}>■</Text>
      )
    const agentLine = isAgentDone ? (
      <Box paddingX={1}>
        <Text color="success">● Claude is done and waiting for you</Text>
      </Box>
    ) : null
    /** The keys that work here, or how to get them working while the pane lacks the keyboard. */
    const hint = (keys: string) => (
      <Box paddingX={1}>
        <Text dimColor wrap="wrap">
          {isFocused ? keys : `Click to play, or ctrl+x tab to give this pane the keyboard (${keys})`}
        </Text>
      </Box>
    )
    const menuButton = <Button key="menu" plain hotkey="m" dimColor label="menu" onPress={() => toMenu($)} />

    // ── menu: a card per game; every text row of a card starts it ──
    if (now.kind === 'menu') {
      const isTwoUp = width >= 70
      const cardWidth = isTwoUp ? Math.floor(width / 2) : width
      const inner = Math.max(8, cardWidth - 4 - iconWidth - 1)
      const accuracy = p.played ? Math.round((100 * p.correct) / p.played) : 0

      return (
        <Box flexDirection="column" gap={1}>
          {headerEl}
          {agentLine}
          <Box flexDirection="row" flexWrap="wrap">
            {GAMES.map(game => {
              const color = hex(GAME_COLOR[game.id])
              const stats = p.games[game.id]
              const meta = stats
                ? `${stats.played} played · ${Math.round((100 * stats.correct) / stats.played)}% right`
                : 'new · give it a go'
              const play = () => void startRound($, game.id)

              return (
                <Box
                  key={`card:${game.id}`}
                  width={cardWidth}
                  borderStyle="round"
                  borderColor={color}
                  hover={{ borderStyle: 'bold' }}
                  paddingX={1}
                  gap={1}
                >
                  {icon(game.id, `icon:${game.id}`)}
                  <Box flexDirection="column">
                    <Button
                      key={`game:${game.id}`}
                      plain
                      hotkey={game.hotkey}
                      label={fit(game.name, inner - 3)}
                      hover={{ color, bold: true }}
                      onPress={play}
                    />
                    <Button key={`game:${game.id}:about`} plain dimColor label={fit(game.blurb, inner)} onPress={play} />
                    <Button key={`game:${game.id}:meta`} plain dimColor label={fit(meta, inner)} onPress={play} />
                  </Box>
                </Box>
              )
            })}
          </Box>
          <Box paddingX={1} gap={2} flexWrap="wrap">
            <Button
              key="surprise"
              variant="primary"
              hotkey="s"
              label="Surprise me"
              onPress={() => void startRound($, pick(GAMES).id)}
            />
            <Button key="topics" plain hotkey="t" label="Topics" onPress={() => show($, 'topics')} />
            <Button key="stats" plain hotkey="p" label="Progress" onPress={() => show($, 'stats')} />
          </Box>
          <Box paddingX={1}>
            <Text dimColor>
              {p.played === 0
                ? 'No rounds yet. Pick a card!'
                : `${p.played} played · ${accuracy}% right · best streak ${p.bestStreak}`}
            </Text>
          </Box>
          {hint('1-6 play a game · s surprise · t topics · p progress')}
        </Box>
      )
    }

    // ── topics: toggles ──
    if (now.kind === 'topics') {
      const chosen = await read($, topics)
      const all = [...TOPIC_PRESETS, ...chosen.filter(t => !TOPIC_PRESETS.includes(t))]

      return (
        <Box flexDirection="column" gap={1}>
          {headerEl}
          <Box borderStyle="round" borderColor={hex(SLATE)} paddingX={1} flexDirection="column" gap={1}>
            <Text bold>Topics rounds are drawn from</Text>
            <Box flexWrap="wrap" columnGap={2}>
              {all.map(topic => {
                const isOn = chosen.includes(topic)

                return (
                  <Button
                    key={`topic:${topic}`}
                    plain
                    label={`${isOn ? '◉' : '○'} ${topic}`}
                    dimColor={!isOn}
                    onPress={() => toggleTopic($, topic)}
                  />
                )
              })}
            </Box>
            <Text dimColor wrap="wrap">
              Anything else: /claudle topics Elixir, Kubernetes, ...
            </Text>
          </Box>
          <Box paddingX={1}>
            <Button key="done" variant="primary" hotkey="m" label="Done" autoFocus onPress={() => toMenu($)} />
          </Box>
          {hint('Tab moves between topics · Enter toggles · m done')}
        </Box>
      )
    }

    // ── progress: per game and per topic ──
    if (now.kind === 'stats') {
      const bar = (fraction: number, cells: number) => {
        const filled = Math.round(Math.min(1, Math.max(0, fraction)) * cells)

        return '█'.repeat(filled) + '░'.repeat(cells - filled)
      }
      const ratings = Object.entries(p.ratings).sort(([, a], [, b]) => b - a)
      const progress = progressFor(p.xp)

      return (
        <Box flexDirection="column" gap={1}>
          {headerEl}
          <Box borderStyle="round" borderColor={hex(SLATE)} paddingX={1} flexDirection="column">
            <Text bold>{titleFor(p.xp)}</Text>
            <Text>
              <Text color={hex(P.amber)}>{bar(progress.progress, 20)}</Text>
              <Text dimColor>
                {progress.nextAt === undefined ? ` ${p.xp} XP, top title` : ` ${p.xp} / ${progress.nextAt} XP to the next title`}
              </Text>
            </Text>
            <Text dimColor>
              {p.played} played · {p.correct} right · streak {p.streak} · best {p.bestStreak}
            </Text>
          </Box>
          <Box borderStyle="round" borderColor={hex(SLATE)} paddingX={1} flexDirection="column">
            <Text bold>Games</Text>
            {GAMES.map(game => {
              const stats = p.games[game.id]
              const rate = stats ? stats.correct / stats.played : 0

              return (
                <Text key={`g:${game.id}`}>
                  <Text color={hex(GAME_COLOR[game.id])}>{fit(game.name, 22)}</Text>
                  {stats ? (
                    <Text>
                      {bar(rate, 10)} <Text dimColor>{`${Math.round(rate * 100)}% of ${stats.played}`}</Text>
                    </Text>
                  ) : (
                    <Text dimColor>not played yet</Text>
                  )}
                </Text>
              )
            })}
          </Box>
          <Box borderStyle="round" borderColor={hex(SLATE)} paddingX={1} flexDirection="column">
            <Text bold>Topics</Text>
            {ratings.length === 0 && <Text dimColor>Play a round to get rated.</Text>}
            {ratings.map(([topic, rating]) => (
              <Text key={`t:${topic}`}>
                {fit(topic, 22)}
                <Text color={hex(P.leaf)}>{'●'.repeat(levelFor(rating))}</Text>
                <Text dimColor>{'○'.repeat(10 - levelFor(rating))}</Text>
                <Text dimColor>{`  level ${levelFor(rating)} · rating ${rating}`}</Text>
              </Text>
            ))}
          </Box>
          <Box paddingX={1}>
            <Button key="done" variant="primary" hotkey="m" label="Back" autoFocus onPress={() => toMenu($)} />
          </Box>
        </Box>
      )
    }

    if (now.kind === 'loading') {
      const color = hex(GAME_COLOR[now.game])

      return (
        <Box flexDirection="column" gap={1}>
          {headerEl}
          {agentLine}
          <Box borderStyle="round" borderColor={color} paddingX={1} gap={1}>
            {icon(now.game, 'icon:round')}
            <Box flexDirection="column">
              <Text bold color={color}>
                {gameOf(now.game).name}
              </Text>
              <Text dimColor italic wrap="wrap">
                {now.line}…
              </Text>
              <Text dimColor>Usually 5 to 20 seconds; the next round is prepared while you play.</Text>
            </Box>
          </Box>
          <Box paddingX={1}>{menuButton}</Box>
        </Box>
      )
    }

    if (now.kind === 'error') {
      const { game } = now

      return (
        <Box flexDirection="column" gap={1}>
          {headerEl}
          <Box borderStyle="round" borderColor="error" paddingX={1}>
            <Text color="error" wrap="wrap">
              {now.message}
            </Text>
          </Box>
          <Box paddingX={1} gap={3}>
            <Button key="retry" variant="primary" hotkey="r" label="Retry" autoFocus onPress={() => void startRound($, game)} />
            {menuButton}
          </Box>
        </Box>
      )
    }

    // ── a round: its card, the code, the answers ──
    const { puzzle } = now
    const game = gameOf(puzzle.game)
    const color = hex(GAME_COLOR[puzzle.game])
    const isBug = puzzle.game === 'spot-the-bug'
    const pips = '●'.repeat(puzzle.level) + '○'.repeat(10 - puzzle.level)
    const card = (
      <Box borderStyle="round" borderColor={color} paddingX={1} gap={1}>
        {icon(puzzle.game, 'icon:round')}
        <Box flexDirection="column" flexShrink={1}>
          <Text>
            <Text backgroundColor={color} color={hex(INK)} bold>
              {` ${game.name.toUpperCase()} `}
            </Text>
            <Text dimColor>{`  ${puzzle.topic}`}</Text>
          </Text>
          <Text bold wrap="wrap">
            {puzzle.title}
          </Text>
          <Text color={color}>
            {pips} <Text dimColor>level {puzzle.level}</Text>
          </Text>
        </Box>
      </Box>
    )
    const code = puzzle.code ? (
      <Box borderStyle="single" borderColor={hex(SLATE)} paddingX={1}>
        <Code
          source={puzzle.code}
          {...(puzzle.language ? { language: puzzle.language } : {})}
          {...(isBug ? { startLine: 1 } : {})}
          wrap="wrap"
        />
      </Box>
    ) : null
    const letters = ['a', 'b', 'c', 'd']

    if (now.kind === 'question' || now.kind === 'grading') {
      let answers
      let keys = 'q ask for a hint · k skip · g give up · m menu'
      if (now.kind === 'grading') {
        answers = (
          <Box borderStyle="round" borderColor={hex(SLATE)} paddingX={1} flexDirection="column">
            <Text dimColor>You said: {now.typed}</Text>
            <Text dimColor italic>
              The judge is reading your answer…
            </Text>
          </Box>
        )
      } else if (isBug) {
        keys = 'type your answer, Enter submits · Esc leaves the field, then q hint · k skip · g give up'
        answers = Input ? (
          <Box borderStyle="round" borderColor={color} paddingX={1} flexDirection="column">
            <Input
              key="answer"
              label="Bug"
              placeholder="line 7: the loop runs one past the end"
              submitLabel="Submit"
              autoFocus
              onSubmit={(value: string) => void answerText($, value)}
            />
          </Box>
        ) : (
          <Text dimColor>Answer with /claudle answer &lt;line and what is wrong&gt;</Text>
        )
      } else if (game.fixedOptions) {
        const cell = Math.max(...game.fixedOptions.map(o => o.length)) + 2
        keys = `${game.fixedOptions.map((o, i) => `${letters[i]} ${o}`).join(' · ')} · q hint · k skip · g give up`
        answers = (
          <Box gap={1} flexWrap="wrap">
            {game.fixedOptions.map((option, i) => (
              <Box key={`box:${i}`} borderStyle="round" borderColor={color} hover={{ borderStyle: 'bold' }} paddingX={1}>
                <Button
                  key={`opt:${i}`}
                  plain
                  hotkey={letters[i]!}
                  label={fit(option, cell)}
                  hover={{ bold: true }}
                  onPress={() => answerChoice($, i)}
                />
              </Box>
            ))}
          </Box>
        )
      } else {
        const inner = width - 4
        keys = 'a-d answer · q hint · k skip · g give up · m menu'
        answers = (
          <Box flexDirection="column">
            {(puzzle.options ?? []).map((option, i) => {
              const isShort = option.length <= inner - 3

              return (
                <Box
                  key={`box:${i}`}
                  borderStyle="round"
                  borderColor={hex(SLATE)}
                  hover={{ borderColor: color }}
                  paddingX={1}
                >
                  {e.surface !== 'terminal' ? (
                    // a native button draws one line and cuts the rest: the letter is the button,
                    // the answer wraps beside it
                    <Box gap={1} alignItems="flex-start">
                      <Button key={`opt:${i}`} hotkey={letters[i]!} label={letters[i]!.toUpperCase()} onPress={() => answerChoice($, i)} />
                      <Box key={`opt-text:${i}`} flexShrink={1}>
                        <Text wrap="wrap">
                          {option}
                        </Text>
                      </Box>
                    </Box>
                  ) : isShort ? (
                    <Button
                      key={`opt:${i}`}
                      plain
                      hotkey={letters[i]!}
                      label={fit(option, inner - 3)}
                      hover={{ bold: true }}
                      onPress={() => answerChoice($, i)}
                    />
                  ) : (
                    <Button key={`opt:${i}`} plain hotkey={letters[i]!} label={option} onPress={() => answerChoice($, i)} />
                  )}
                </Box>
              )
            })}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" gap={1}>
          {headerEl}
          {agentLine}
          {card}
          <Box paddingX={1}>
            <Text wrap="wrap" bold={puzzle.game === 'review-court'}>
              {puzzle.prompt}
            </Text>
          </Box>
          {code}
          {answers}
          {talk && (talk.isOpen || talk.turns.length > 0) ? tutor(puzzle, false) : null}
          {now.kind === 'question' && (
            <Box paddingX={1} gap={3}>
              <Button key="hint" plain hotkey="q" label="ask for a hint" onPress={() => openTutor($)} />
              <Button key="skip" plain hotkey="k" dimColor label="skip" onPress={() => void startRound($, puzzle.game)} />
              <Button key="giveup" plain hotkey="g" dimColor label="give up" onPress={() => giveUp($)} />
              {menuButton}
            </Box>
          )}
          {now.kind === 'question' && hint(keys)}
        </Box>
      )
    }

    // ── feedback ──
    const { outcome } = now
    const isWin = outcome.score >= 50
    let reveal
    if (isBug) {
      reveal = (
        <Box flexDirection="column" paddingX={1}>
          {outcome.typed !== undefined && <Text dimColor wrap="wrap">You said: {outcome.typed}</Text>}
          <Text wrap="wrap">{outcome.verdict}</Text>
          <Text wrap="wrap">
            <Text bold color={color}>
              Line {puzzle.bugLine}:
            </Text>{' '}
            {puzzle.bug}
          </Text>
        </Box>
      )
    } else {
      reveal = (
        <Box flexDirection="column" paddingX={1}>
          {outcome.picked === undefined && <Text wrap="wrap">{outcome.verdict}</Text>}
          {(puzzle.options ?? []).map((option, i) =>
            i === puzzle.answer ? (
              <Text key={`r:${i}`} color="success" bold wrap="wrap">
                ✓ {option}
              </Text>
            ) : i === outcome.picked ? (
              <Text key={`r:${i}`} color="error" strikethrough wrap="wrap">
                ✗ {option}
              </Text>
            ) : (
              <Text key={`r:${i}`} dimColor wrap="wrap">
                {`  ${option}`}
              </Text>
            ),
          )}
        </Box>
      )
    }
    const ratingText = `${outcome.ratingDelta >= 0 ? '+' : ''}${outcome.ratingDelta}`

    return (
      <Box flexDirection="column" gap={1}>
        {headerEl}
        {agentLine}
        <Box backgroundColor={hex(isWin ? MOSS : BLOOD)} paddingX={1} justifyContent="space-between">
          <Text bold color="#ffffff">
            {isWin ? '✓ CORRECT' : '✗ NOT QUITE'}
            {isBug && outcome.typed !== undefined ? `  ${outcome.score}/100` : ''}
          </Text>
          <Text bold color="#ffffff">
            +{outcome.points} XP
          </Text>
        </Box>
        {card}
        {code}
        {reveal}
        <Box borderStyle="round" borderColor={hex(SLATE)} paddingX={1} flexDirection="column">
          <Text bold color={color}>
            Why
          </Text>
          <Text wrap="wrap">{puzzle.explanation}</Text>
        </Box>
        {puzzle.quip !== '' && (
          <Box paddingX={1}>
            <Text italic color={hex(ORANGE)} wrap="wrap">
              “{puzzle.quip}”
            </Text>
          </Box>
        )}
        <Box paddingX={1}>
          <Text dimColor>
            {puzzle.topic} rating {ratingText} · streak {p.streak}
          </Text>
        </Box>
        {tutor(puzzle, true)}
        <Box paddingX={1} gap={3}>
          <Button
            key="next"
            variant="primary"
            hotkey="n"
            label="Next round"
            autoFocus
            onPress={() => void startRound($, puzzle.game)}
          />
          <Button key="ask" plain hotkey="q" label="ask Claude" onPress={() => openTutor($)} />
          <Button key="other" plain hotkey="o" label="other game" onPress={() => toMenu($)} />
        </Box>
        {hint('Enter or n next round · q ask Claude about it · o pick another game')}
      </Box>
    )
  })
}

/** `text` cut or padded to exactly `n` columns, so a Button fills its row. */
function fit(text: string, n: number): string {
  const chars = [...text]

  return chars.length > n ? chars.slice(0, Math.max(0, n - 1)).join('') + '…' : text + ' '.repeat(n - chars.length)
}
