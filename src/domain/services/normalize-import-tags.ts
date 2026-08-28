// TAG-001 B1: pure normalisation for per-row CSV tags. Split on ';', trim,
// drop blanks, drop names over 40 chars (mirrors the `tags.name` CHECK and
// `normalizeTagName` in domain/entities/tag.ts — but DROPS + COUNTS instead
// of throwing, since a CSV cell is advisory input, not a domain command),
// dedupe case-insensitively with first-seen casing winning, then cap at
// MAX_TAGS_PER_ROW (excess counted too). Imported by both the client parser
// (parse-csv.ts) and the server preflight (import-contacts-batch-validation.ts)
// so preview and commit always agree on what counts as "the same tag".

export const MAX_TAGS_PER_ROW = 10
const MAX_TAG_NAME_LEN = 40

export interface NormalizeImportTagsResult {
  names: string[]
  ignored: number
}

/** name.trim().toLowerCase() — the ONLY matching key used anywhere for CSV tags. */
export function tagKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Parses one raw CSV cell (semicolon-separated tag names). */
export function normalizeImportTags(
  raw: string | null | undefined
): NormalizeImportTagsResult {
  const parts = typeof raw === 'string' ? raw.split(';') : []
  return normalizeImportTagNames(parts)
}

/**
 * Re-normalises an already-split array of tag names. Used server-side to
 * re-derive names from a wire body (`row.tags: string[]`) — the server never
 * trusts client-supplied casing, whitespace, length, or dedup.
 */
export function normalizeImportTagNames(
  rawNames: string[]
): NormalizeImportTagsResult {
  // The wire body is client-controlled, so `rawNames` is only a string[] by
  // convention. A non-array would make the `for…of` below throw deep inside
  // preflight and surface as a 500 (review round 2, finding 6).
  if (!Array.isArray(rawNames)) return { names: [], ignored: 0 }
  let ignored = 0
  const seen = new Map<string, string>() // tagKey -> first-seen casing
  for (const rawName of rawNames) {
    const trimmed = typeof rawName === 'string' ? rawName.trim() : ''
    if (trimmed.length === 0) continue
    if (trimmed.length > MAX_TAG_NAME_LEN) {
      ignored += 1
      continue
    }
    const key = tagKey(trimmed)
    if (!seen.has(key)) seen.set(key, trimmed)
  }
  const names = [...seen.values()]
  if (names.length > MAX_TAGS_PER_ROW) {
    ignored += names.length - MAX_TAGS_PER_ROW
    return { names: names.slice(0, MAX_TAGS_PER_ROW), ignored }
  }
  return { names, ignored }
}
