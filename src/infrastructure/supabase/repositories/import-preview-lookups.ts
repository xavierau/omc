import { createServerSupabaseClient } from '../client'

/**
 * Read-only preview lookups for the import wizard (#139.2, AD-3). Deliberately
 * narrow, dedicated queries — NOT a reuse of
 * `findActiveMarketingConsentForPhones` (consent-record-repository.ts),
 * which `select('*')` and is the commit path's shared hot-path read. Widening
 * or repurposing that select for preview is exactly the coupling
 * `principle_shared_select_migration_coupling` warns against.
 *
 * `restaurant_id` is always inside the query (authorize by scoped query),
 * never a post-filter.
 */
export const PREVIEW_CHUNK = 500
export const MAX_CONCURRENT_CHUNKS = 4

function toChunks(items: string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** Runs `worker` over `phones` in chunks, at most MAX_CONCURRENT_CHUNKS in flight, unioning the results into one Set. */
async function runChunked(
  phones: string[],
  worker: (batch: string[]) => Promise<string[]>
): Promise<Set<string>> {
  const out = new Set<string>()
  const chunks = toChunks(phones, PREVIEW_CHUNK)
  for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_CHUNKS) {
    const window = chunks.slice(i, i + MAX_CONCURRENT_CHUNKS)
    const results = await Promise.all(window.map(worker))
    for (const batch of results) for (const phone of batch) out.add(phone)
  }
  return out
}

/**
 * Phones that already belong to a member for this tenant. No status filter
 * (AM-4) — the unique index and `resolveMemberId` in the commit path don't
 * filter by member status either, so this must match that behaviour exactly.
 */
export async function findExistingMemberPhones(
  restaurantId: string,
  phones: string[]
): Promise<Set<string>> {
  if (phones.length === 0) return new Set()
  const supabase = createServerSupabaseClient()
  return runChunked(phones, async (batch) => {
    const { data, error } = await supabase
      .from('members')
      .select('phone')
      .eq('restaurant_id', restaurantId)
      .in('phone', batch)
    if (error) throw new Error(`findExistingMemberPhones: ${error.message}`)
    return (data ?? []).map((row) => row.phone as string)
  })
}

/**
 * Phones already holding active marketing consent (`opted_in` or `pending`
 * — AM-5, matching `idx_consent_active_uniq` / ACTIVE_STATUSES).
 */
export async function findActiveMarketingConsentPhones(
  restaurantId: string,
  phones: string[]
): Promise<Set<string>> {
  if (phones.length === 0) return new Set()
  const supabase = createServerSupabaseClient()
  return runChunked(phones, async (batch) => {
    const { data, error } = await supabase
      .from('consent_records')
      .select('phone_e164')
      .eq('restaurant_id', restaurantId)
      .eq('category', 'marketing')
      .in('status', ['opted_in', 'pending'])
      .in('phone_e164', batch)
    if (error) {
      throw new Error(`findActiveMarketingConsentPhones: ${error.message}`)
    }
    return (data ?? []).map((row) => row.phone_e164 as string)
  })
}
