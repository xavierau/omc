// A small PostgREST stand-in over an in-memory table: filters accumulate, awaiting
// applies them. Filters follow SQL's NULL rules, and an `.or` it cannot parse throws,
// so a test can never pass because the fake ignored a predicate.

export type FakeRow = Record<string, unknown>
type RowFilter = (row: FakeRow) => boolean

interface FakeTableOptions {
  /** Return a message to fail an update touching these rows, as a timeout would. */
  updateError?: (patch: FakeRow, matched: FakeRow[]) => string | null
}

// A comparison against NULL is unknown, and NOT unknown is still unknown.
function comparison(operator: string, value: string): (cell: unknown) => boolean {
  if (operator === 'eq') return (cell) => cell === value
  if (operator === 'match') {
    const pattern = new RegExp(value)
    return (cell) => pattern.test(String(cell))
  }
  throw new Error(`fakeTable: unsupported .or operator '${operator}'`)
}

function parseOrTerm(term: string): RowFilter {
  const parsed = /^(\w+)\.(not\.)?(\w+)\.(.*)$/.exec(term)
  if (!parsed) throw new Error(`fakeTable: unparseable .or term '${term}'`)
  const [, column, not, operator, value] = parsed
  if (operator === 'is' && value === 'null') {
    return (row) => (row[column] ?? null) === null !== Boolean(not)
  }
  const compare = comparison(operator, value)
  return (row) => {
    const cell = row[column] ?? null
    if (cell === null) return false
    return compare(cell) !== Boolean(not)
  }
}

export function fakeTable(rows: FakeRow[], options: FakeTableOptions = {}) {
  const filters: RowFilter[] = []
  let patch: FakeRow | null = null
  let inserted: FakeRow | null = null
  const matching = () => rows.filter((row) => filters.every((keep) => keep(row)))
  const chain = {
    select: () => chain,
    insert: (row: FakeRow) => {
      inserted = row
      return chain
    },
    update: (values: FakeRow) => {
      patch = values
      return chain
    },
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value)
      return chain
    },
    neq: (column: string, value: unknown) => {
      filters.push((row) => row[column] !== value)
      return chain
    },
    in: (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]))
      return chain
    },
    is: (column: string, value: unknown) => {
      filters.push((row) => (row[column] ?? null) === value)
      return chain
    },
    lt: (column: string, value: string) => {
      filters.push((row) => String(row[column]) < value)
      return chain
    },
    or: (expression: string) => {
      const terms = expression.split(',').map(parseOrTerm)
      filters.push((row) => terms.some((term) => term(row)))
      return chain
    },
    then: (resolve: (result: unknown) => unknown) => {
      if (inserted) rows.push(inserted)
      const found = matching()
      const failure = patch && options.updateError?.(patch, found)
      if (failure) {
        return Promise.resolve({ data: null, count: null, error: { message: failure } }).then(resolve)
      }
      if (patch) found.forEach((row) => Object.assign(row, patch))
      return Promise.resolve({ data: found, count: found.length, error: null }).then(resolve)
    },
  }
  return chain
}
