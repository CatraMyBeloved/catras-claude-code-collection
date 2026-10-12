import type { GameId, Profile, Puzzle } from '../types'

export type Game = {
  id: GameId
  name: string
  blurb: string
  hotkey: string
  /** Options the pane shows in this fixed order (never shuffled). */
  fixedOptions?: string[]
  /** What the model must produce for this game, appended to the shared rules. */
  brief: (topic: string, level: number) => string
}

export const GAMES: Game[] = [
  {
    id: 'spot-the-bug',
    name: 'Spot the Bug',
    blurb: 'one planted bug, explain it',
    hotkey: '1',
    brief: (topic, level) => `GAME: Spot the Bug.
Write a realistic ${topic} snippet of 8 to ${10 + level * 2} lines with exactly ONE planted bug that a careful reviewer could find by reading.
Level ${level}/10: 1-3 obvious (wrong operator, off-by-one), 4-6 needs thought (mutation, async ordering, edge cases), 7-10 subtle (concurrency, numeric precision, unicode, security).
The code must look plausible, use descriptive names, and contain NO comments that hint at the bug.
JSON fields: title, prompt (one line of context: what the code is meant to do), code, language, bugLine (1-based line number of the bug), bug (one sentence: what is wrong and the fix), explanation (2-3 sentences teaching the lesson), quip.`,
  },
  {
    id: 'what-prints',
    name: 'What Does It Print?',
    blurb: 'predict the output',
    hotkey: '2',
    brief: (topic, level) => `GAME: What Does It Print?
Write a short ${topic} snippet (3 to ${6 + level} lines) whose output is surprising but fully deterministic and well documented (coercion, scoping, mutability, operator precedence, evaluation order, integer/float behaviour, etc.).
Level ${level}/10: low levels are classic gotchas, high levels combine several.
TRACE THE PROGRAM STEP BY STEP before answering; the correct option must be exactly what it prints. If ${topic} is not a programming language (e.g. Git, SQL, Shell), use its command or query output instead.
JSON fields: title, prompt (e.g. "What does this print?"), code, language, options (exactly 4 distinct outputs, all plausible), answer (0-based index of the correct one), explanation (why, 2-3 sentences), quip.`,
  },
  {
    id: 'two-truths',
    name: 'Two Truths and a Lie',
    blurb: 'find the false claim',
    hotkey: '3',
    brief: (topic, level) => `GAME: Two Truths and a Lie.
Write three short factual-sounding claims about ${topic} (behaviour, defaults, history, standard library, tooling). Exactly one is false.
Level ${level}/10: at high levels the lie should be a common misconception and the truths should sound surprising.
Only use facts you are certain about.
JSON fields: title, prompt ("Which one is the lie?"), options (the 3 claims), answer (0-based index of the LIE), explanation (correct the lie and add one surprising detail about a truth), quip.`,
  },
  {
    id: 'real-or-fake',
    name: 'Real or Hallucinated?',
    blurb: 'does this API exist?',
    hotkey: '4',
    fixedOptions: ['Real', 'Hallucinated'],
    brief: (topic, level) => `GAME: Real or Hallucinated?
Name ONE function, method, flag, option or config key in ${topic} or its common ecosystem, shown as a call or usage line, with a one-sentence description of what it supposedly does.
Flip a coin: half the time it must REALLY exist exactly as written, half the time it must be a convincing fabrication (a name an AI might invent).
Level ${level}/10: high levels use obscure real APIs and fakes that are one detail off from real ones.
Only claim "real" for things you are certain exist in current stable versions.
JSON fields: title, prompt (the description of what it supposedly does), code (the usage line), language, options (["Real", "Hallucinated"]), answer (0 if real, 1 if hallucinated), explanation (what actually exists and where), quip.`,
  },
  {
    id: 'review-court',
    name: 'Code Review Court',
    blurb: 'rule on a review comment',
    hotkey: '5',
    fixedOptions: ['Valid', 'Nitpick', 'Wrong'],
    brief: (topic, level) => `GAME: Code Review Court.
Show a small ${topic} diff or snippet (4 to 14 lines) from a pull request, and one reviewer comment on it.
The comment is either Valid (points at a real problem worth fixing), a Nitpick (true but style or taste, not worth blocking), or Wrong (the reviewer is mistaken). Pick one of the three roughly at random.
Level ${level}/10: high levels make the distinction genuinely debatable but still with one best ruling.
JSON fields: title, prompt (the reviewer comment, quoted, prefixed by a made-up reviewer handle like "@grumpy-dev:"), code, language, options (["Valid", "Nitpick", "Wrong"]), answer (0, 1 or 2), explanation (the ruling, as a judge would deliver it, 2-3 sentences), quip.`,
  },
  {
    id: 'big-o',
    name: 'Big-O Bingo',
    blurb: 'guess the complexity',
    hotkey: '6',
    brief: (topic, level) => `GAME: Big-O Bingo.
Write a ${topic} function of 4 to ${8 + level} lines and ask for its worst-case time complexity in terms of the named input size(s).
Level ${level}/10: high levels hide the cost in library calls (list.remove, string concatenation, includes inside loops, sorting, hash collisions are NOT a trick to use).
If ${topic} is not a programming language, use SQL query plans or shell pipelines over n lines instead.
JSON fields: title, prompt (e.g. "Worst-case time complexity? n = len(items)"), code, language, options (exactly 4 distinct complexities like "O(n log n)"), answer (0-based index of the correct one), explanation (where the cost comes from), quip.`,
  },
]

export function gameOf(id: GameId): Game {
  return GAMES.find(g => g.id === id) ?? GAMES[0]!
}

export const SYSTEM = `You are the quizmaster of Claudle, a set of quick programming games played in a terminal while a coding agent works.
Personality: a witty, slightly smug but fair senior engineer. Puzzles must be technically correct above all; humour lives in the "title" and "quip" fields only.
Reply with ONE JSON object and nothing else: no markdown fences, no prose before or after.
Common JSON fields: "title" (a punny 2-6 word round name), "quip" (one short funny line shown after the answer).
Code goes in "code" as plain text with real newlines escaped as \\n, at most 70 characters per line.`

export function generationPrompt(game: Game, topic: string, level: number, avoid: string[]): string {
  const avoidLine = avoid.length > 0 ? `\nDo not reuse these recent rounds or their ideas: ${avoid.join('; ')}.` : ''

  return `${game.brief(topic, level)}${avoidLine}\nReply with the JSON object only.`
}

export function gradingPrompt(puzzle: Puzzle, typed: string): string {
  return `GRADE an answer to a Spot the Bug round.
Code (${puzzle.language ?? puzzle.topic}), lines numbered:
${numbered(puzzle.code ?? '')}
The planted bug is on line ${puzzle.bugLine}: ${puzzle.bug}
The player answered: """${typed.slice(0, 600)}"""
Score 0-100: 100 = right line and right reason; 60-90 = right reason, line missing or slightly off; 30-50 = right line, vague or wrong reason; 0-20 = wrong. If the player found a DIFFERENT genuine bug, give 70 and say so.
JSON fields: score (integer), verdict (one or two sentences addressed to the player, in character).`
}

export function numbered(code: string): string {
  return code
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(2)}  ${line}`)
    .join('\n')
}

/** The first JSON object in a reply, tolerating fences or prose around it. */
export function parseJson(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))

    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

/** Checks a generated round and shapes it for the pane; undefined when it is unusable. */
export function toPuzzle(
  game: Game,
  topic: string,
  level: number,
  raw: Record<string, unknown>,
  random: () => number = Math.random,
): Puzzle | undefined {
  const title = str(raw.title)
  const prompt = str(raw.prompt)
  const explanation = str(raw.explanation)
  if (!title || !prompt || !explanation) return undefined
  const code = str(raw.code)?.replace(/\t/g, '  ')
  const base: Puzzle = {
    game: game.id,
    topic,
    level,
    title,
    prompt,
    explanation,
    quip: str(raw.quip) ?? '',
    ...(code ? { code } : {}),
    ...(str(raw.language) ? { language: str(raw.language)!.toLowerCase() } : {}),
  }

  if (game.id === 'spot-the-bug') {
    const bugLine = Number(raw.bugLine)
    const bug = str(raw.bug)
    const lines = code?.split('\n').length ?? 0
    if (!code || !bug || !Number.isInteger(bugLine) || bugLine < 1 || bugLine > lines) return undefined

    return { ...base, bugLine, bug }
  }

  const answer = Number(raw.answer)
  if (game.fixedOptions) {
    if (!Number.isInteger(answer) || answer < 0 || answer >= game.fixedOptions.length) return undefined

    return { ...base, options: game.fixedOptions, answer }
  }

  const options = Array.isArray(raw.options) ? raw.options.map(o => String(o).trim()) : []
  const wanted = game.id === 'two-truths' ? 3 : 4
  if (options.length !== wanted || new Set(options).size !== wanted) return undefined
  if (!Number.isInteger(answer) || answer < 0 || answer >= wanted) return undefined
  if (game.id !== 'two-truths' && !code) return undefined

  const order = options.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }

  return { ...base, options: order.map(i => options[i]!), answer: order.indexOf(answer) }
}

// ── Rating and scoring ────────────────────────────────────────────────

export const START_RATING = 1000

export function levelFor(rating: number): number {
  return Math.min(10, Math.max(1, Math.round((rating - 700) / 100)))
}

/** Elo against a round of the given level; `score` is 0 to 100. */
export function ratingDelta(rating: number, level: number, score: number): number {
  const expected = 1 / (1 + 10 ** ((700 + level * 100 - rating) / 400))

  return Math.round(40 * (score / 100 - expected))
}

export function pointsFor(level: number, score: number, streak: number): number {
  if (score < 50) return 0
  const multiplier = 1 + Math.min(streak, 10) * 0.1

  return Math.round(level * 10 * (score / 100) * multiplier)
}

export const TITLES: [number, string][] = [
  [0, 'Fresh Intern'],
  [100, 'Rubber Duck Whisperer'],
  [300, 'Off-By-One Survivor'],
  [700, 'Stack Overflow Regular'],
  [1500, 'Merge Conflict Mediator'],
  [3000, 'Senior Stack-Trace Reader'],
  [6000, '10x Debugger'],
  [12000, 'Principal Pedant'],
]

export function titleFor(xp: number): string {
  return TITLES.filter(([min]) => xp >= min).at(-1)![1]
}

/** How far `xp` is toward the next title: 0..1, and the XP that title needs. */
export function progressFor(xp: number): { progress: number; nextAt: number | undefined } {
  const i = TITLES.findIndex(([min]) => xp < min)
  if (i < 0) return { progress: 1, nextAt: undefined }
  const from = TITLES[i - 1]![0]
  const to = TITLES[i]![0]

  return { progress: (xp - from) / (to - from), nextAt: to }
}

export function emptyProfile(): Profile {
  return { xp: 0, played: 0, correct: 0, streak: 0, bestStreak: 0, games: {}, ratings: {}, recent: {} }
}

export const LOADING_LINES = [
  'Claude is hiding a bug where you least expect it',
  'Consulting the ancient scrolls of Stack Overflow',
  'Sharpening the off-by-one',
  'Asking the rubber duck for a hard one',
  'Generating plausible-looking nonsense (some of it true)',
  'Reticulating splines',
  'Bribing the type checker to look away',
  'Writing a commit message that says "small fix"',
]

/** Topics the pane offers as toggles; any other can be added with /claudle topics. */
export const TOPIC_PRESETS = [
  'JavaScript',
  'TypeScript',
  'Python',
  'SQL',
  'Git',
  'Shell',
  'Rust',
  'Go',
  'Java',
  'C#',
  'C++',
  'Regex',
  'HTTP',
  'Docker',
  'React',
  'CSS',
]

// ── Ask Claude: the tutor ─────────────────────────────────────────────

export const TUTOR_SYSTEM = `You are Claude, a patient and encouraging programming tutor inside Claudle, a quiz game played in a terminal pane.
Teach, don't just tell: name the underlying concept, give the mental model, and show how to recognise the pattern next time in real code.
Keep replies short and skimmable: at most about 180 words, plain markdown (short paragraphs, bullets, code blocks of at most 10 lines). No headings.
Correct misconceptions gently and specifically. A little humour is welcome, but teaching comes first.
When it helps, end with ONE short check-your-understanding question or tiny exercise.
The rounds are generated by a model and can be wrong. If the round, its answer or your earlier reply contains a mistake, say so plainly and give the correct version.`

export const HINT_RULES = `THE PLAYER HAS NOT ANSWERED YET. Never reveal, confirm or rule out the answer or any option, and never name the buggy line.
Give Socratic hints instead: point at what to look at, which rule applies, or a question to ask themselves. Each new hint may be a bit stronger than the last.
If they ask for the answer outright, decline playfully and give a stronger hint.`

/** Everything the tutor should know about the round, the player's answer, and the chat so far. */
export function tutorPrompt(
  puzzle: Puzzle,
  outcome: { score: number; picked?: number; typed?: string } | undefined,
  turns: readonly { who: 'you' | 'claude'; text: string }[],
  question: string,
): string {
  const lines = [
    `ROUND: ${gameOf(puzzle.game).name} · ${puzzle.topic} · level ${puzzle.level}/10 · "${puzzle.title}"`,
    `Shown to the player: ${puzzle.prompt}`,
  ]
  if (puzzle.code) lines.push(`Code (${puzzle.language ?? puzzle.topic}):\n${numbered(puzzle.code)}`)
  if (puzzle.options) lines.push(`Options:\n${puzzle.options.map((o, i) => `  ${'abcd'[i]}) ${o}`).join('\n')}`)
  const answer =
    puzzle.game === 'spot-the-bug'
      ? `The planted bug is on line ${puzzle.bugLine}: ${puzzle.bug}`
      : `Correct answer: ${'abcd'[puzzle.answer ?? 0]}) ${puzzle.options?.[puzzle.answer ?? 0]}`
  lines.push(`${answer}\nExplanation given to the player afterwards: ${puzzle.explanation}`)
  if (outcome) {
    const said =
      outcome.typed !== undefined
        ? `The player answered: "${outcome.typed}"`
        : outcome.picked !== undefined
          ? `The player picked ${'abcd'[outcome.picked]}) ${puzzle.options?.[outcome.picked]}`
          : 'The player gave up without answering.'
    lines.push(`${said} (score ${outcome.score}/100).`)
  } else {
    lines.push(HINT_RULES)
  }
  if (turns.length > 0) {
    lines.push('CONVERSATION SO FAR:')
    for (const t of turns.slice(-8)) lines.push(`${t.who === 'you' ? 'Player' : 'You'}: ${t.text}`)
  }
  lines.push(`PLAYER'S QUESTION: ${question.slice(0, 1000)}`)

  return lines.join('\n\n')
}

export const ASK_BEFORE = ['Give me a hint', 'What concept is this testing?']
export const ASK_AFTER = ['Explain it step by step', 'Show me a similar example', 'How do I spot this in real code?']
