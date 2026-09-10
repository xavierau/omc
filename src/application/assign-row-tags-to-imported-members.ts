import {
  normalizeImportTagNames,
  tagKey,
} from '@/domain/services/normalize-import-tags'
import { getOrCreateTagsByName } from '@/infrastructure/supabase/repositories/tag-get-or-create'
import {
  upsertMemberTagPairs,
  type MemberTagPair,
} from '@/infrastructure/supabase/repositories/member-tag-pairs'

export interface RowTagAssignment {
  memberId: string
  tagNames: string[]
}

export interface AssignRowTagsToImportedMembersInput {
  restaurantId: string
  rows: RowTagAssignment[]
}

export interface AssignRowTagsToImportedMembersResult {
  /** Distinct member ids that received at least one (member, tag) pair. */
  taggedMembers: number
}

/**
 * Applies the CSV per-row tag NAMES to the member ids the consent fan-out
 * produced (plan invariant 3 — this runs strictly after that fan-out and is
 * keyed only off ids it returned).
 *
 * Names are re-normalised here even though the preflight already did it: the
 * caller is not a trust boundary, and `normalizeImportTagNames` is the single
 * definition that keeps preview and commit agreeing.
 */
export async function assignRowTagsToImportedMembers(
  input: AssignRowTagsToImportedMembersInput
): Promise<AssignRowTagsToImportedMembersResult> {
  const rows = normalizeRows(input.rows)
  if (rows.length === 0) return { taggedMembers: 0 }
  const idsByKey = await getOrCreateTagsByName(input.restaurantId, distinctNames(rows))
  const pairs = buildPairs(rows, idsByKey)
  if (pairs.length === 0) return { taggedMembers: 0 }
  await upsertMemberTagPairs(input.restaurantId, pairs)
  return { taggedMembers: new Set(pairs.map((pair) => pair.memberId)).size }
}

function normalizeRows(rows: RowTagAssignment[]): RowTagAssignment[] {
  const out: RowTagAssignment[] = []
  for (const row of rows) {
    const { names } = normalizeImportTagNames(row.tagNames)
    if (names.length > 0) out.push({ memberId: row.memberId, tagNames: names })
  }
  return out
}

/** Distinct names across every row, case-insensitive, first-seen casing wins. */
function distinctNames(rows: RowTagAssignment[]): string[] {
  const byKey = new Map<string, string>()
  for (const row of rows) {
    for (const name of row.tagNames) {
      const key = tagKey(name)
      if (!byKey.has(key)) byKey.set(key, name)
    }
  }
  return [...byKey.values()]
}

function buildPairs(
  rows: RowTagAssignment[],
  idsByKey: Map<string, string>
): MemberTagPair[] {
  const seen = new Set<string>()
  const pairs: MemberTagPair[] = []
  for (const row of rows) {
    for (const name of row.tagNames) {
      const tagId = idsByKey.get(tagKey(name))
      // Never silently drop a tag the merchant asked for (plan R-4).
      if (!tagId) throw new Error(`assignRowTagsToImportedMembers: unresolved tag "${name}"`)
      const pairKey = `${row.memberId}:${tagId}`
      if (seen.has(pairKey)) continue
      seen.add(pairKey)
      pairs.push({ memberId: row.memberId, tagId })
    }
  }
  return pairs
}
