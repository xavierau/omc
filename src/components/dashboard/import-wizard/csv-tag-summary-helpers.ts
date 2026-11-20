/**
 * TAG-001 F1 / AD-10 — pure client-side summary of per-row CSV tags, derived
 * entirely from `PreviewRow[].tags` (accepted rows only — B1 already echoes
 * nothing for rejected rows) and the tenant's existing tag list. No new
 * preview API surface; matching uses `tagKey`, the same key B2's get-or-create
 * and B1's parser use, so "new" is never a false positive from a casing
 * mismatch.
 */
import { tagKey } from '@/domain/services/normalize-import-tags'

export interface TagSummaryEntry {
  name: string
  count: number
  isNew: boolean
}

export function summariseRowTags(
  rows: Array<{ tags: string[] }>,
  existingTags: Array<{ name: string }>
): TagSummaryEntry[] {
  const existingKeys = new Set(existingTags.map((tag) => tagKey(tag.name)))
  const counts = new Map<string, { name: string; count: number }>()

  for (const row of rows) {
    for (const tag of row.tags) {
      const key = tagKey(tag)
      const entry = counts.get(key)
      if (entry) {
        entry.count += 1
      } else {
        counts.set(key, { name: tag, count: 1 })
      }
    }
  }

  return [...counts.entries()]
    .map(([key, { name, count }]) => ({ name, count, isNew: !existingKeys.has(key) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
