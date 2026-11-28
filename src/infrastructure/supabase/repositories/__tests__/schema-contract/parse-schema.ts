// INT-001 WI-19 (D2): statically extracts the REAL column set for a table
// from the migration SQL files themselves -- "a static test; must fail on
// `response_excerpt` before the fix and pass after" (see
// integration-schema-contract.test.ts). Reading the migrations, not a
// hand-maintained mirror, is the point: a hand-mirror would have missed the
// exact drift (071 created `last_response_excerpt`, the repository kept
// reading/writing `response_excerpt`) that caused the prod relay to fail
// every tick (release runbook D2).
import fs from 'node:fs'
import path from 'node:path'

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')
const CONSTRAINT_KEYWORDS = /^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|CONSTRAINT)\b/i

/** Splits a CREATE TABLE body on commas, but only at paren-depth 0 -- a
 * CHECK (x IN ('a', 'b')) constraint's internal commas must NOT split it
 * into separate "column" segments. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

function extractColumnsFromBody(body: string): string[] {
  return splitTopLevel(body)
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && !CONSTRAINT_KEYWORDS.test(seg))
    .map((seg) => seg.split(/\s+/)[0])
    .filter((name) => /^[a-z_][a-z0-9_]*$/.test(name))
}

/** Given the index of an opening `(`, returns the text strictly between it
 * and its matching `)` (depth-tracked, so nested CHECK(...) parens don't
 * end the scan early). */
function textBetweenBalancedParens(text: string, openIndex: number): string {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++
    if (text[i] === ')') {
      depth--
      if (depth === 0) return text.slice(openIndex + 1, i)
    }
  }
  throw new Error('textBetweenBalancedParens: unbalanced parentheses')
}

/** Strips `-- ...` line comments before any structural parsing -- several
 * migrations comment a column with a trailing English sentence containing
 * its OWN comma (e.g. "Last 4 digits only, for support/ops correlation..."
 * above `phone_last4 TEXT` in 070), which a comma-splitter with no comment
 * awareness would otherwise treat as a top-level column separator. */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function columnsFromCreateTable(sql: string, table: string): string[] {
  const createRe = new RegExp(`CREATE TABLE\\s+${table}\\s*\\(`, 'i')
  const match = createRe.exec(sql)
  if (!match) return []
  const openIndex = match.index + match[0].length - 1
  return extractColumnsFromBody(textBetweenBalancedParens(sql, openIndex))
}

function columnsFromAlterTable(sql: string, table: string): string[] {
  const addColRe = new RegExp(
    `ALTER TABLE\\s+${table}\\s+ADD COLUMN\\s+(?:IF NOT EXISTS\\s+)?([a-z_][a-z0-9_]*)`,
    'gi'
  )
  return [...sql.matchAll(addColRe)].map((m) => m[1])
}

/** Every column ever declared for `table` across the full migration
 * history: its CREATE TABLE body, plus any later `ALTER TABLE ... ADD
 * COLUMN` (none exist for the six INT-001 tables today -- migrations
 * 072-076 only add functions/policies -- but a future migration that adds
 * one is still picked up here without this file changing). */
export function columnsForTable(table: string): Set<string> {
  const columns = new Set<string>()
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = stripLineComments(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
    columnsFromCreateTable(sql, table).forEach((c) => columns.add(c))
    columnsFromAlterTable(sql, table).forEach((c) => columns.add(c))
  }
  if (columns.size === 0) throw new Error(`columnsForTable: no CREATE TABLE found for "${table}"`)
  return columns
}
