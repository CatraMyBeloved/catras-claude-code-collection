// What the agent's main-thread tool calls mean to the comic beyond the director's log: the cue over
// Claude's head as one starts, the activity canned scenes act out, the moments the stage shows at once
// (a commit's flag, a push's balloon, the task trail), and failures, which cloud the sky.

import type { Weather } from './backdrop'
import type { Activity } from './canned'
import { cellText } from './canvas'
import { stage } from './runtime'
import { clip } from './scene'
import type { Stage } from './stage'

const WEATHER_MS = 180_000 // failures this recent cloud the sky
const TEST_RUN = /\b(?:jest|vitest|pytest|mocha|rspec|ctest|tox|phpunit)\b|\b(?:cargo|go|bun|deno|dotnet|mvn|gradle|npm|pnpm|yarn)\s+(?:run\s+)?test\b|\bplugin test\b|\bmake (?:test|check)\b/

/** Which mark each tool puts over Claude's head as it starts. */
export const CUES: Record<string, Parameters<Stage['cue']>[0]> = {
  Read: 'read', NotebookRead: 'read',
  Grep: 'search', Glob: 'search',
  Edit: 'edit', Write: 'edit', NotebookEdit: 'edit',
  Bash: 'run', PowerShell: 'run',
  WebFetch: 'web', WebSearch: 'web',
}

let failTimes: number[] = [] // recent failures: they bring clouds, and rain
let tasksMade = 0 // TaskCreate calls this list
const tasksDone = new Set<string>()

const baseName = (path: string) => clip(cellText(path.split(/[\\/]/).pop() ?? path), 20)

/**
 * One main-thread tool call, finished: `act` gets the activity it was for canned scenes, and the stage
 * shows its moments (git, the task trail) at once.
 */
export function observe(e: Record<string, unknown>, ran: { isError?: boolean; deny?: string }, act: (a: Activity) => void) {
  const str = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const isFailed = ran.isError === true || ran.deny !== undefined
  const fail = (label?: string) => {
    failTimes.push(Date.now())
    act({ kind: 'fail', label })
  }
  switch (String(e.tool)) {
    case 'Read': case 'NotebookRead':
      return isFailed ? fail(baseName(str('file_path'))) : act({ kind: 'read', label: baseName(str('file_path')) })
    case 'Edit': case 'Write': case 'NotebookEdit':
      return isFailed ? fail(baseName(str('file_path'))) : act({ kind: 'edit', label: baseName(str('file_path')) })
    case 'Grep': case 'Glob':
      return act({ kind: 'search', label: clip(cellText(str('pattern')), 20) })
    case 'WebFetch': case 'WebSearch':
      return isFailed ? fail() : act({ kind: 'web' })
    case 'Agent':
      return act({ kind: 'helper' })
    case 'TodoWrite': {
      const todos = Array.isArray(e.todos) ? (e.todos as { status?: unknown }[]) : []
      const done = todos.filter(t => t?.status === 'completed').length
      stage.progress = todos.length ? { done, total: todos.length } : null
      return
    }
    case 'TaskCreate':
      if (!isFailed) tasksMade++
      return showTasks()
    case 'TaskUpdate': {
      const id = str('taskId') || str('id')
      if (!isFailed && id && e.status === 'completed') tasksDone.add(id)
      return showTasks()
    }
    case 'Bash': case 'PowerShell': {
      const command = str('command')
      if (/\bgit\s+commit\b/.test(command) && !isFailed) {
        stage.gitMoment('commit')
        return act({ kind: 'commit' })
      }
      if (/\bgit\s+push\b/.test(command) && !isFailed) {
        stage.gitMoment('push')
        return act({ kind: 'push' })
      }
      if (TEST_RUN.test(command)) {
        if (isFailed) failTimes.push(Date.now())
        else failTimes = [] // green again: the sky clears
        return act({ kind: 'test', ok: !isFailed })
      }
      return isFailed ? fail() : act({ kind: 'run' })
    }
  }
  if (isFailed) fail()
}

function showTasks() {
  if (tasksMade > 0) stage.progress = { done: Math.min(tasksDone.size, tasksMade), total: tasksMade }
}

/** A new turn: a finished task list is done with; one still under way carries on into it. */
export function clearFinishedTasks() {
  if (!stage.progress || stage.progress.done < stage.progress.total) return
  stage.progress = null
  tasksMade = 0
  tasksDone.clear()
}

/** Clear, cloudy after a failure, rain after several: the last few minutes' work, in the sky. */
export function weatherAt(now: number): Weather {
  failTimes = failTimes.filter(t => now - t < WEATHER_MS)
  return failTimes.length >= 3 ? 'rain' : failTimes.length ? 'cloudy' : 'clear'
}
