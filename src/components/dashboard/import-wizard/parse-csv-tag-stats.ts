/**
 * TAG-001 review fix I-2 — pure aggregate over already-parsed CSV rows for
 * the upload-step feedback lines (`csv.tagsFound` / `csv.tagsIgnored`,
 * plan Feedback State 1). Sibling to parse-csv.ts rather than a change to
 * parseCsv's return shape, so parseCsv() and its existing tests are
 * untouched.
 */
import { tagKey } from '@/domain/services/normalize-import-tags'
import type { ParsedRow } from './parse-csv'

export interface CsvTagStats {
  /** Count of distinct tags (via tagKey) across every row's accepted tags. */
  distinctTags: number
  /** Sum of every row's ignoredTagCount (blank, >40 chars, or over the per-row cap). */
  ignoredTagValues: number
}

export function computeCsvTagStats(rows: ParsedRow[]): CsvTagStats {
  const distinct = new Set<string>()
  let ignoredTagValues = 0
  for (const row of rows) {
    for (const name of row.tags) distinct.add(tagKey(name))
    ignoredTagValues += row.ignoredTagCount
  }
  return { distinctTags: distinct.size, ignoredTagValues }
}
