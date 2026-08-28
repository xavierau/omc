/**
 * Minimal CSV parser for the import wizard's Step 2 client-side preview.
 * Header-driven: looks for `phone` (required), `name`, `preferred_language`.
 * Server-side parser remains the source of truth at commit time.
 *
 * Note: avoids adding a heavy dep for MVP. Doesn't handle quoted commas in
 * cells — when needed, swap in `papaparse`.
 */

import { normalizeImportTags } from '@/domain/services/normalize-import-tags'

export interface ParsedRow {
  phoneE164: string
  name: string | null
  preferredLanguage: 'en' | 'zh_hk' | null
  tags: string[]
}

const PHONE_HEADERS = ['phone', 'phonee164', 'phone_e164']
const NAME_HEADERS = ['name', 'fullname']
const LANG_HEADERS = ['preferred_language', 'language', 'lang']
const TAGS_HEADERS = ['tags', 'tag']

export function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return []
  const headers = lines[0].split(',').map((c) => c.trim().toLowerCase())
  const idxPhone = findIndex(headers, PHONE_HEADERS)
  if (idxPhone < 0) return []
  const idxName = findIndex(headers, NAME_HEADERS)
  const idxLang = findIndex(headers, LANG_HEADERS)
  const idxTags = findIndex(headers, TAGS_HEADERS)
  const rows: ParsedRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim())
    const phone = cells[idxPhone] ?? ''
    if (phone.length === 0) continue
    rows.push({
      phoneE164: phone,
      name: idxName >= 0 ? cellOrNull(cells[idxName]) : null,
      preferredLanguage: idxLang >= 0 ? normaliseLang(cells[idxLang]) : null,
      tags: idxTags >= 0 ? normalizeImportTags(cells[idxTags]).names : [],
    })
  }
  return rows
}

function findIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((h) => aliases.includes(h))
}

function cellOrNull(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normaliseLang(value: string | undefined): 'en' | 'zh_hk' | null {
  if (!value) return null
  const lower = value.trim().toLowerCase()
  if (lower === 'en') return 'en'
  if (lower === 'zh_hk' || lower === 'zh-hk') return 'zh_hk'
  return null
}
