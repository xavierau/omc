import type { createServerSupabaseClient } from '@/infrastructure/supabase/client'

type ServerSupabase = ReturnType<typeof createServerSupabaseClient>

/**
 * Generic array chunking, extracted out of resolve-campaign-members.ts
 * (which sits at the 150-line budget) to keep `.in('id', ids)` calls under
 * PostgREST's URL-length limit — R-8 / B4.4.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** PostgREST's own default `max-rows`; one round trip per page. */
export const READ_PAGE_SIZE = 1000

interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

/**
 * Walk a PostgREST read page by page until a short page arrives.
 *
 * An unpaged read is truncated at the project's `max-rows` (Supabase default
 * 1000) with NO error — the caller just silently sees fewer rows. Any read that
 * can exceed that must therefore drive `.range()` itself (review I-5(a)).
 */
export async function readAllPages<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = READ_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw new Error(`${label}: ${error.message}`)
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

/**
 * Deduped member ids carrying any of `tagIds`, tenant-scoped and fully paged.
 * The campaign recipient count (RPC 067) counts every row, so this read must
 * too or the send targets a subset of the audience the merchant was shown.
 */
export async function fetchTaggedMemberIds(
  supabase: ServerSupabase,
  restaurantId: string,
  tagIds: string[]
): Promise<string[]> {
  const rows = await readAllPages<{ member_id: string }>(
    'fetchTagMembers',
    (from, to) =>
      supabase
        .from('member_tags')
        .select('member_id')
        .eq('restaurant_id', restaurantId)
        .in('tag_id', tagIds)
        .range(from, to)
  )
  return [...new Set(rows.map((r) => r.member_id))]
}
