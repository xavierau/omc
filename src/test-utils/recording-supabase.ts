// A Supabase client stand-in that records every query-builder call and
// resolves the chain with a scripted result. For asserting the SHAPE of a
// query (which filters scope it, which columns it writes) where the
// semantics are proven elsewhere against real Postgres (booking.db.test.ts).
export type RecordedCall = [method: string, ...args: unknown[]]

export interface RecordedQuery {
  table: string
  calls: RecordedCall[]
}

type Result = { data?: unknown; error?: { message: string } | null; count?: number | null }

const CHAIN_METHODS = [
  'select', 'insert', 'update', 'delete', 'eq', 'neq', 'is', 'in', 'gt', 'lt', 'gte', 'lte', 'or', 'order', 'limit',
]

export function recordingSupabase(results: Result[] | ((query: RecordedQuery) => Result)) {
  const queries: RecordedQuery[] = []
  const next = (query: RecordedQuery): Result =>
    typeof results === 'function' ? results(query) : (results[queries.indexOf(query)] ?? { data: null, error: null })

  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, calls: [] }
      queries.push(query)
      const settle = () => {
        const r = next(query)
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null })
      }
      const chain: Record<string, unknown> = {}
      for (const method of CHAIN_METHODS) {
        chain[method] = (...args: unknown[]) => {
          query.calls.push([method, ...args])
          return chain
        }
      }
      chain.single = () => (query.calls.push(['single']), settle())
      chain.maybeSingle = () => (query.calls.push(['maybeSingle']), settle())
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => settle().then(resolve, reject)
      return chain
    },
  }
  return { client, queries }
}

/** The filters of one recorded query as `method:column=value` strings. */
export function filtersOf(query: RecordedQuery): string[] {
  return query.calls
    .filter(([m]) => ['eq', 'neq', 'is', 'gt', 'lt', 'or', 'in'].includes(m))
    .map(([m, column, value]) => (m === 'or' ? `or:${String(column)}` : `${m}:${String(column)}=${String(value)}`))
}
