#!/usr/bin/env npx tsx
import { readFileSync } from 'fs'
import { resolve } from 'path'

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  gray: '\x1b[90m',
}

const PRIORITY_BADGE: Record<string, string> = {
  critical: `${COLORS.bgRed}${COLORS.white}${COLORS.bold} CRIT ${COLORS.reset}`,
  high: `${COLORS.bgYellow}${COLORS.bold} HIGH ${COLORS.reset}`,
  medium: `${COLORS.bgBlue}${COLORS.white} MED  ${COLORS.reset}`,
  low: `${COLORS.gray} LOW  ${COLORS.reset}`,
}

const COLUMN_HEADER: Record<string, string> = {
  backlog: `${COLORS.gray}`,
  todo: `${COLORS.yellow}`,
  in_progress: `${COLORS.cyan}`,
  review: `${COLORS.magenta}`,
  done: `${COLORS.green}`,
  removed: `${COLORS.red}`,
}

interface Task {
  id: string
  title: string
  description?: string
  priority?: string
  labels?: string[]
  estimate?: string
  depends_on?: string[]
  acceptance_criteria?: string[]
  rationale?: string
  note?: string
  completed_at?: string
  removal_reason?: string
  trigger?: string
}

interface Column {
  label: string
  tasks: Task[]
}

interface Board {
  project: string
  updated_at: string
  columns: Record<string, Column>
  sprint_priority_order?: string[]
  key_insight?: { summary: string; implication: string }
}

function loadBoard(): Board {
  const path = resolve(__dirname, '../.claude/kanban.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function line(char = '─', len = 60): string {
  return char.repeat(len)
}

function renderLabels(labels?: string[]): string {
  if (!labels?.length) return ''
  return labels.map((l) => `${COLORS.dim}[${l}]${COLORS.reset}`).join(' ')
}

function renderTask(task: Task, verbose: boolean): string {
  const lines: string[] = []
  const priority = task.priority ? PRIORITY_BADGE[task.priority] ?? '' : ''
  const estimate = task.estimate ? `${COLORS.dim}(${task.estimate})${COLORS.reset}` : ''
  const id = `${COLORS.bold}${task.id}${COLORS.reset}`

  lines.push(`  ${priority} ${id}  ${task.title} ${estimate}`)

  if (task.labels?.length) {
    lines.push(`         ${renderLabels(task.labels)}`)
  }

  if (verbose) {
    if (task.description) {
      const wrapped = wordWrap(task.description, 55)
      wrapped.forEach((l) => lines.push(`         ${COLORS.dim}${l}${COLORS.reset}`))
    }
    if (task.depends_on?.length) {
      lines.push(`         ${COLORS.yellow}depends: ${task.depends_on.join(', ')}${COLORS.reset}`)
    }
    if (task.trigger) {
      lines.push(`         ${COLORS.cyan}trigger: ${task.trigger}${COLORS.reset}`)
    }
    if (task.rationale) {
      lines.push(`         ${COLORS.green}why: ${task.rationale}${COLORS.reset}`)
    }
    if (task.completed_at) {
      lines.push(`         ${COLORS.green}completed: ${task.completed_at}${COLORS.reset}`)
    }
    if (task.removal_reason) {
      lines.push(`         ${COLORS.red}reason: ${task.removal_reason}${COLORS.reset}`)
    }
    if (task.acceptance_criteria?.length) {
      lines.push(`         ${COLORS.dim}acceptance:${COLORS.reset}`)
      task.acceptance_criteria.forEach((ac) => {
        lines.push(`           ${COLORS.dim}- ${ac}${COLORS.reset}`)
      })
    }
  }

  return lines.join('\n')
}

function renderColumn(key: string, col: Column, verbose: boolean): string {
  const color = COLUMN_HEADER[key] ?? COLORS.white
  const count = col.tasks.length
  const header = `${color}${COLORS.bold}  ${col.label.toUpperCase()} (${count})${COLORS.reset}`
  const lines: string[] = [
    '',
    `${color}${line('━', 60)}${COLORS.reset}`,
    header,
    `${color}${line('─', 60)}${COLORS.reset}`,
  ]

  if (count === 0) {
    lines.push(`  ${COLORS.dim}(empty)${COLORS.reset}`)
  } else {
    col.tasks.forEach((task) => {
      lines.push(renderTask(task, verbose))
      lines.push('')
    })
  }

  return lines.join('\n')
}

function renderSprint(order: string[]): string {
  const lines: string[] = [
    '',
    `${COLORS.bold}${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`,
    `${COLORS.bold}${COLORS.cyan}  SPRINT PRIORITY${COLORS.reset}`,
    `${COLORS.cyan}${line('─', 60)}${COLORS.reset}`,
  ]
  order.forEach((item, i) => {
    lines.push(`  ${COLORS.bold}${i + 1}.${COLORS.reset} ${item}`)
  })
  return lines.join('\n')
}

function renderInsight(insight: { summary: string; implication: string }): string {
  const lines: string[] = [
    '',
    `${COLORS.bold}${COLORS.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`,
    `${COLORS.bold}${COLORS.green}  KEY INSIGHT${COLORS.reset}`,
    `${COLORS.green}${line('─', 60)}${COLORS.reset}`,
  ]
  wordWrap(insight.summary, 56).forEach((l) => {
    lines.push(`  ${COLORS.bold}${l}${COLORS.reset}`)
  })
  lines.push('')
  wordWrap(insight.implication, 56).forEach((l) => {
    lines.push(`  ${COLORS.dim}${l}${COLORS.reset}`)
  })
  return lines.join('\n')
}

function wordWrap(text: string, maxLen: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current.length + word.length + 1 > maxLen) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines
}

function renderStats(board: Board): string {
  const cols = board.columns
  const counts: Record<string, number> = {}
  let total = 0
  for (const [key, col] of Object.entries(cols)) {
    if (key === 'removed') continue
    counts[col.label] = col.tasks.length
    total += col.tasks.length
  }

  const bar = (label: string, count: number, color: string) => {
    const width = total > 0 ? Math.max(1, Math.round((count / total) * 30)) : 0
    const block = '\u2588'.repeat(width)
    return `  ${color}${block}${COLORS.reset} ${label}: ${count}`
  }

  const lines = [
    '',
    `${COLORS.bold}  BOARD STATS${COLORS.reset}  (${total} tasks)`,
    `${COLORS.dim}${line('─', 60)}${COLORS.reset}`,
    bar('Backlog', counts['Backlog'] ?? 0, COLORS.gray),
    bar('To Do', counts['To Do'] ?? 0, COLORS.yellow),
    bar('In Progress', counts['In Progress'] ?? 0, COLORS.cyan),
    bar('Review', counts['Review'] ?? 0, COLORS.magenta),
    bar('Done', counts['Done'] ?? 0, COLORS.green),
  ]
  return lines.join('\n')
}

// --- main ---

const args = process.argv.slice(2)
const verbose = args.includes('-v') || args.includes('--verbose')
const filterCol = args.find((a) => !a.startsWith('-'))

const board = loadBoard()

console.log('')
console.log(`${COLORS.bold}${COLORS.white}  ${board.project}${COLORS.reset}`)
console.log(`${COLORS.dim}  Updated: ${board.updated_at}${COLORS.reset}`)

if (filterCol) {
  const key = filterCol.toLowerCase().replace(/ /g, '_')
  const col = board.columns[key]
  if (col) {
    console.log(renderColumn(key, col, true))
  } else {
    console.log(`${COLORS.red}  Column "${filterCol}" not found.${COLORS.reset}`)
    console.log(`${COLORS.dim}  Available: ${Object.keys(board.columns).join(', ')}${COLORS.reset}`)
  }
} else {
  const displayOrder = ['in_progress', 'review', 'todo', 'backlog', 'done', 'removed']
  for (const key of displayOrder) {
    const col = board.columns[key]
    if (col) console.log(renderColumn(key, col, verbose))
  }

  if (board.sprint_priority_order) {
    console.log(renderSprint(board.sprint_priority_order))
  }

  if (board.key_insight) {
    console.log(renderInsight(board.key_insight))
  }

  console.log(renderStats(board))
}

console.log('')
