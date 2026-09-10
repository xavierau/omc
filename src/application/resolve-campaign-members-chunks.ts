/**
 * Paging helper for the campaign recipient reads in
 * resolve-campaign-members.ts. It used to also hold a generic `chunk()` for
 * keeping `.in('id', ids)` calls under PostgREST's URL length; both that
 * helper and the member-id round trip it served are gone with #162 —
 * recipients now resolve through the migration-079 RPCs, so nothing chunks
 * ids any more and only the page walk remains.
 */

/** PostgREST's own default `max-rows`; one round trip per page. */
export const READ_PAGE_SIZE = 1000

interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

/**
 * Walk a PostgREST read page by page until an EMPTY page arrives.
 *
 * An unpaged read is truncated at the project's `max-rows` (Supabase default
 * 1000) with NO error — the caller just silently sees fewer rows, and this
 * applies to a set-returning RPC's result as much as to a table read. Any read
 * that can exceed the cap must therefore drive its own window: `.range()` for
 * a table read, `p_limit`/`p_offset` for an RPC (review I-5(a), #162).
 *
 * Two details that a short-page loop gets wrong when the project's `max-rows`
 * is configured BELOW `pageSize` (review round 2, #2):
 *  - stopping on a short page stops on the FIRST page, losing the rest;
 *  - advancing the cursor by `pageSize` skips every row the server withheld.
 * So the loop ends only on an empty page and advances by rows RECEIVED.
 *
 * `fetchPage` must impose a total order on the rows it windows — `.order()`
 * on a table read, `ORDER BY` inside the function for an RPC. Without one,
 * a different row order per request lets the walk repeat or drop rows across
 * page boundaries.
 */
export async function readAllPages<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = READ_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; ) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw new Error(`${label}: ${error.message}`)
    const page = data ?? []
    if (page.length === 0) return rows
    rows.push(...page)
    from += page.length
  }
}
