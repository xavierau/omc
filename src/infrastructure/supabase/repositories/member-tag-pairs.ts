import { createServerSupabaseClient } from '../client'

/** Chunk size for the member_tags upsert — keeps one request well inside
 *  PostgREST's payload limits at the import cap (50,000 rows × 10 tags). */
const PAIR_CHUNK = 1000

export interface MemberTagPair {
  memberId: string
  tagId: string
}

/**
 * Idempotent, ADD-ONLY write of explicit (member, tag) pairs.
 *
 * Unlike `upsertMemberTags`, which writes the full memberIds × tagIds
 * cross-product, this takes the pairs the caller computed — CSV per-row tags
 * give each member a DIFFERENT tag set, so a cross-product would be wrong.
 *
 * `ignoreDuplicates` on the (member_id, tag_id) PK is what makes re-importing
 * the same file a no-op (plan A4). Nothing here deletes (plan A5).
 */
export async function upsertMemberTagPairs(
  restaurantId: string,
  pairs: MemberTagPair[]
): Promise<void> {
  if (pairs.length === 0) return
  const supabase = createServerSupabaseClient()
  for (let i = 0; i < pairs.length; i += PAIR_CHUNK) {
    const rows = pairs.slice(i, i + PAIR_CHUNK).map((pair) => ({
      member_id: pair.memberId,
      tag_id: pair.tagId,
      restaurant_id: restaurantId,
    }))
    const { error } = await supabase.from('member_tags').upsert(rows, {
      onConflict: 'member_id,tag_id',
      ignoreDuplicates: true,
    })
    if (error) throw new Error(`upsertMemberTagPairs: ${error.message}`)
  }
}
