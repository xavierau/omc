import { createServerSupabaseClient } from '../client'
import { tagKey } from '@/domain/services/normalize-import-tags'

interface UpsertTagRow {
  id: string
  name: string
}

/**
 * Commit-time get-or-create for CSV per-row tag names (migration 068, AM-2).
 *
 * Returns `tagKey(name) -> tagId` for every requested name, creating only the
 * ones the tenant does not already have. Matching is case-insensitive against
 * `idx_tags_restaurant_lower_name`, which PostgREST cannot target — hence the
 * RPC. The function deduplicates and drops blanks server-side, so callers may
 * pass the row names as normalised.
 *
 * Callers must key every lookup with `tagKey`, never a raw string: the RPC
 * echoes the tenant's STORED casing (`VIP`), which need not match the CSV's.
 *
 * A name missing from the returned map means the DB refused it (e.g. the
 * `tags_name_check` 1..40 CHECK). Callers must treat that as an error, never
 * as "skip this tag".
 */
export async function getOrCreateTagsByName(
  restaurantId: string,
  names: string[]
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>()
  if (names.length === 0) return byKey
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('upsert_tags_by_name', {
    p_restaurant_id: restaurantId,
    p_names: names,
  })
  if (error) throw new Error(`getOrCreateTagsByName: ${error.message}`)
  for (const row of (data ?? []) as UpsertTagRow[]) {
    byKey.set(tagKey(row.name), row.id)
  }
  return byKey
}
