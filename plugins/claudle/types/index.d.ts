export type GameId = 'spot-the-bug' | 'what-prints' | 'two-truths' | 'real-or-fake' | 'review-court' | 'big-o'

/** One generated round, as the pane shows it. */
export type Puzzle = {
  /** Unique per generated round; the Ask Claude chat is keyed on it. */
  id?: string
  game: GameId
  topic: string
  level: number
  title: string
  prompt: string
  code?: string
  language?: string
  /** Choice games: the options in display order, and which one is right. */
  options?: string[]
  answer?: number
  /** Spot the Bug: the planted bug, kept hidden until graded. */
  bugLine?: number
  bug?: string
  explanation: string
  quip: string
}

export type Outcome = {
  /** 0 to 100: a choice is 0 or 100, a free answer is graded. */
  score: number
  verdict: string
  /** The option picked, for a choice game. */
  picked?: number
  /** What the person typed, for a free answer. */
  typed?: string
  points: number
  ratingDelta: number
}

export type View =
  | { kind: 'menu' }
  | { kind: 'loading'; game: GameId; line: string }
  | { kind: 'question'; puzzle: Puzzle }
  | { kind: 'grading'; puzzle: Puzzle; typed: string }
  | { kind: 'feedback'; puzzle: Puzzle; outcome: Outcome }
  | { kind: 'error'; game: GameId; message: string }
  | { kind: 'stats' }
  | { kind: 'topics' }

export type Profile = {
  xp: number
  played: number
  correct: number
  streak: number
  bestStreak: number
  /** Rounds played and won per game. */
  games: Partial<Record<GameId, { played: number; correct: number }>>
  /** Elo-style rating per topic; the level of the next round follows it. */
  ratings: Record<string, number>
  /** Recent round titles per game, so the model does not repeat itself. */
  recent: Record<string, string[]>
}

export type ChatTurn = { who: 'you' | 'claude'; text: string }

/** The Ask Claude conversation about the round on screen. */
export type Chat = {
  /** Which round it belongs to; a new round starts a new chat. */
  round: string
  turns: ChatTurn[]
  isPending: boolean
  /** Shown while a round is still open (it always shows once answered). */
  isOpen: boolean
}

declare module 'claude-code' {
  interface PluginState {
    claudle: { view: View; profile: Profile; topics: string[]; agentDone: boolean; chat: Chat }
  }
}
