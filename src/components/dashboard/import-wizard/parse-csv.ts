/**
 * Client-side CSV parser for the import wizard. This is the only parser: the
 * client posts already-parsed row objects (`ImportBatchWireBody.rows`), the
 * server never receives the CSV text, and nothing downstream re-checks
 * column alignment. Tokenising is RFC 4180 (`csv-tokenizer.ts`: quoted
 * fields, `""` escapes, commas/newlines inside quotes, CRLF, leading BOM).
 * Header-driven: `phone` (required), `name`, `preferred_language`, `tags`,
 * matched case-insensitively by alias. Data rows whose cell count differs
 * from the header's are rejected here (`rejected[]`) and shown on the
 * upload step — never imported shifted.
 */

import { normalizeImportTags } from '@/domain/services/normalize-import-tags'
import { tokenizeCsv, type CsvRecord } from './csv-tokenizer'

export interface ParsedRow {
  phoneE164: string
  name: string | null
  preferredLanguage: 'en' | 'zh_hk' | null
  tags: string[]
  /** Tag values `normalizeImportTags` dropped for this row (blank, >40 chars,
   * or over the per-row cap). Feeds the batch-level tagsIgnored stat in
   * parse-csv-tag-stats.ts (I-2). */
  ignoredTagCount: number
}

export type CsvParseRejectReason = 'column_count_mismatch' | 'unterminated_quote'

export interface CsvParseReject {
  /** 1-based physical line where the record starts. The header is line 1. */
  line: number
  reason: CsvParseRejectReason
  /** Header cell count. */
  expected: number
  /** This record's cell count. */
  actual: number
  /** Trimmed phone cell when the record has one at the header's phone index and it is non-empty. */
  phone: string | null
}

export interface ParseCsvResult {
  /** false when the text is empty or no header cell matches a phone alias —
   *  the existing `csv.errors.empty` path. `rows` and `rejected` are both [] in that case. */
  phoneHeaderFound: boolean
  rows: ParsedRow[]
  rejected: CsvParseReject[]
}

const PHONE_HEADERS = ['phone', 'phonee164', 'phone_e164']
const NAME_HEADERS = ['name', 'fullname']
const LANG_HEADERS = ['preferred_language', 'language', 'lang']
const TAGS_HEADERS = ['tags', 'tag']

interface HeaderIndexes {
  idxPhone: number
  idxName: number
  idxLang: number
  idxTags: number
}

type RecordOutcome =
  | { kind: 'row'; row: ParsedRow }
  | { kind: 'reject'; reject: CsvParseReject }
  | { kind: 'skip' }

export function parseCsv(text: string): ParseCsvResult {
  const records = tokenizeCsv(text)
  const header = records.length > 0 ? matchHeader(records[0].cells) : null
  if (!header) return { phoneHeaderFound: false, rows: [], rejected: [] }

  const expected = records[0].cells.length
  const rows: ParsedRow[] = []
  const rejected: CsvParseReject[] = []
  for (const record of records.slice(1)) {
    const outcome = classifyRecord(record, header, expected)
    if (outcome.kind === 'row') rows.push(outcome.row)
    else if (outcome.kind === 'reject') rejected.push(outcome.reject)
  }
  return { phoneHeaderFound: true, rows, rejected }
}

function matchHeader(cells: string[]): HeaderIndexes | null {
  const headers = cells.map((c) => c.trim().toLowerCase())
  const idxPhone = findIndex(headers, PHONE_HEADERS)
  if (idxPhone < 0) return null
  return {
    idxPhone,
    idxName: findIndex(headers, NAME_HEADERS),
    idxLang: findIndex(headers, LANG_HEADERS),
    idxTags: findIndex(headers, TAGS_HEADERS),
  }
}

function classifyRecord(record: CsvRecord, header: HeaderIndexes, expected: number): RecordOutcome {
  if (record.unterminated) {
    return { kind: 'reject', reject: buildReject(record, 'unterminated_quote', expected, header.idxPhone) }
  }
  if (record.cells.length !== expected) {
    return { kind: 'reject', reject: buildReject(record, 'column_count_mismatch', expected, header.idxPhone) }
  }
  const phone = cellOrNull(record.cells[header.idxPhone])
  if (!phone) return { kind: 'skip' }
  return { kind: 'row', row: buildRow(record.cells, header, phone) }
}

function buildReject(
  record: CsvRecord,
  reason: CsvParseRejectReason,
  expected: number,
  idxPhone: number
): CsvParseReject {
  return { line: record.line, reason, expected, actual: record.cells.length, phone: cellOrNull(record.cells[idxPhone]) }
}

function buildRow(cells: string[], header: HeaderIndexes, phone: string): ParsedRow {
  const tagResult = header.idxTags >= 0 ? normalizeImportTags(cells[header.idxTags]) : { names: [], ignored: 0 }
  return {
    phoneE164: phone,
    name: header.idxName >= 0 ? cellOrNull(cells[header.idxName]) : null,
    preferredLanguage: header.idxLang >= 0 ? normaliseLang(cells[header.idxLang]) : null,
    tags: tagResult.names,
    ignoredTagCount: tagResult.ignored,
  }
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
