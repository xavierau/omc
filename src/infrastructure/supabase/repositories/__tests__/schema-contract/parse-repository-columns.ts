// INT-001 WI-19 (D2): the other half of the schema-contract check -- every
// column a repository file actually reads/writes via `.select(...)`,
// `.insert(...)` or `.update(...)`, ATTRIBUTED TO THE TABLE its `.from(...)`
// call names (one file can touch more than one table --
// integration-event-repository.ts's pruneOrphanIntegrationEvents reads
// `integration_deliveries.event_id` alongside `integration_events` rows).
// Deliberately scoped to those three Supabase query-builder methods (the
// WI-19 brief's own scope); WHERE-clause columns (`.eq`/`.order`/`.lt`/...)
// are out of scope for this check.
import fs from 'node:fs'

function textBetweenBalancedBraces(text: string, openIndex: number): string {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(openIndex + 1, i)
    }
  }
  throw new Error('textBetweenBalancedBraces: unbalanced braces')
}

/** Object-literal keys (`snake_case_key:`) inside one `{ ... }` body. */
function objectKeys(body: string): string[] {
  const re = /(?:^|[{,])\s*([a-z_][a-z0-9_]*)\s*:/g
  return [...body.matchAll(re)].map((m) => m[1])
}

interface FromCallSite {
  table: string
  index: number
}

function fromCallSites(source: string): FromCallSite[] {
  const fromRe = /\.from\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/g
  return [...source.matchAll(fromRe)].map((m) => ({
    table: (m[1] ?? m[2]) as string,
    index: m.index as number,
  }))
}

/** Splits `source` into one chunk per `.from('table')` call, each chunk
 * running up to (not including) the NEXT `.from()` call -- so a
 * `.select()`/`.insert()`/`.update()` chained onto `.from('x')` is scanned
 * only against `x`, even when the same file later chains onto `.from('y')`. */
function chunksByFromCall(source: string): Array<{ table: string; chunk: string }> {
  const sites = fromCallSites(source)
  return sites.map((site, i) => ({
    table: site.table,
    chunk: source.slice(site.index, i + 1 < sites.length ? sites[i + 1].index : source.length),
  }))
}

function splitColumnList(raw: string): string[] {
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c !== '*')
}

/** Resolves a bare identifier passed to `.select(NAME)` back to the column
 * list it holds -- either `const NAME = '...'` (one long string) or
 * `const NAME = [...].join(', ')` (array-of-literals, joined). Looks in
 * `fullSource` (module scope), not the call-site chunk. */
function resolveIdentifierColumns(fullSource: string, name: string): string[] {
  const stringConst = new RegExp(`const\\s+${name}\\s*=\\s*'([^']*)'`).exec(fullSource)
  if (stringConst) return splitColumnList(stringConst[1])

  const arrayConst = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*\\.join\\(`).exec(fullSource)
  if (arrayConst) return [...arrayConst[1].matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1])

  throw new Error(`resolveIdentifierColumns: could not resolve .select(${name})`)
}

function selectColumns(chunk: string, fullSource: string): string[] {
  const columns: string[] = []
  const callRe = /\.select\(\s*(?:'([^']*)'|"([^"]*)"|(\w+))\s*[,)]/g
  for (const m of chunk.matchAll(callRe)) {
    if (m[1] !== undefined) columns.push(...splitColumnList(m[1]))
    else if (m[2] !== undefined) columns.push(...splitColumnList(m[2]))
    else columns.push(...resolveIdentifierColumns(fullSource, m[3]))
  }
  return columns
}

/** `.insert({...})` / `.update({...})` INLINE object literals within one
 * `.from()` chunk. The `const row: Record<string, unknown> = {...}` builder
 * pattern (used by integration-settings-repository.ts's partial-update
 * functions) is handled separately by `rowBuilderColumns` below, since its
 * declaration sits BEFORE the `.from()` call it's later passed to. */
function inlineInsertUpdateColumns(chunk: string): string[] {
  const columns: string[] = []
  for (const m of chunk.matchAll(/\.(?:insert|update)\(\s*\{/g)) {
    const braceIndex = chunk.indexOf('{', m.index)
    columns.push(...objectKeys(textBetweenBalancedBraces(chunk, braceIndex)))
  }
  return columns
}

/** The `row` builder pattern: `const row: Record<string, unknown> = {...}`
 * plus later `row.field = value` conditionals, ending in a bare
 * `.update(row)`. Each occurrence is attributed to whichever `.from(table)`
 * call comes NEXT after it in the source (the row is always built, then
 * immediately used, within the same function). */
function rowBuilderColumnsByTable(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const sites = fromCallSites(source)
  const tableAfter = (index: number): string | undefined => sites.find((s) => s.index > index)?.table
  const add = (table: string | undefined, cols: string[]) => {
    if (!table) return
    result.set(table, [...(result.get(table) ?? []), ...cols])
  }

  for (const m of source.matchAll(/row:\s*Record<string,\s*unknown>\s*=\s*\{/g)) {
    const braceIndex = source.indexOf('{', m.index)
    add(tableAfter(m.index as number), objectKeys(textBetweenBalancedBraces(source, braceIndex)))
  }
  for (const m of source.matchAll(/\brow\.([a-z_][a-z0-9_]*)\s*=/g)) {
    add(tableAfter(m.index as number), [m[1]])
  }
  return result
}

/** Every column token `filePath` references via `.select`/`.insert`/
 * `.update`, keyed by the table its `.from(...)` call named -- the "used"
 * side a schema-contract test diffs against the real schema per table
 * (parse-schema.ts's `columnsForTable`). */
export function repositoryColumnsByTable(filePath: string): Map<string, Set<string>> {
  const source = fs.readFileSync(filePath, 'utf8')
  const result = new Map<string, Set<string>>()
  const add = (table: string, cols: string[]) => {
    const set = result.get(table) ?? new Set<string>()
    cols.forEach((c) => set.add(c))
    result.set(table, set)
  }

  for (const { table, chunk } of chunksByFromCall(source)) {
    add(table, selectColumns(chunk, source))
    add(table, inlineInsertUpdateColumns(chunk))
  }
  for (const [table, cols] of rowBuilderColumnsByTable(source)) {
    add(table, cols)
  }
  return result
}
