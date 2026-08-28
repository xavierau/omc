/**
 * RFC 4180 CSV tokeniser for the import wizard. Zero dependencies, single
 * O(n) pass over the raw text via charCodeAt — no regex, no whole-string
 * split. Quoted fields, `""` escapes, commas/newlines inside quotes, CRLF /
 * lone-CR terminators and a leading BOM are handled here so `parse-csv.ts`
 * never re-derives column boundaries from a naive `line.split(',')`
 * (WONB-018 / #148).
 */

export interface CsvRecord {
  /** 1-based physical line where the record starts. The header is line 1. */
  line: number
  /** Raw cells — not trimmed; quotes and `""` escapes already resolved. */
  cells: string[]
  /** true only on the final record, when EOF was reached inside a quoted field. */
  unterminated: boolean
}

const SPACE = 32
const TAB = 9
const NBSP = 0xa0
const IDEOGRAPHIC_SPACE = 0x3000
const COMMA = 44
const CR = 13
const LF = 10
const QUOTE = 34
const BOM = 0xfeff

interface State {
  text: string
  i: number
  len: number
  line: number
  recordStartLine: number
  cells: string[]
  cell: string
  inQuotes: boolean
  quotedCell: boolean
  lastCellWasQuoted: boolean
  cellStarted: boolean
  records: CsvRecord[]
}

export function tokenizeCsv(text: string): CsvRecord[] {
  const s = initState(text)
  while (s.i < s.len) {
    if (s.inQuotes) stepQuoted(s)
    else stepUnquoted(s)
  }
  finalizeAtEof(s)
  return s.records
}

function initState(text: string): State {
  const i = text.charCodeAt(0) === BOM ? 1 : 0
  return {
    text, i, len: text.length, line: 1, recordStartLine: 1, cells: [], cell: '',
    inQuotes: false, quotedCell: false, lastCellWasQuoted: false, cellStarted: false,
    records: [],
  }
}

function stepUnquoted(s: State): void {
  const c = s.text.charCodeAt(s.i)
  if (!s.cellStarted && isLeadingBlank(c)) { s.i++; return }
  if (!s.cellStarted) {
    s.cellStarted = true
    if (c === QUOTE) { s.inQuotes = true; s.quotedCell = true; s.i++; return }
  }
  if (c === COMMA) { pushCell(s); s.i++; return }
  if (c === LF) return endRecordAt(s, 1)
  if (c === CR) return endRecordAt(s, isCharAt(s, s.i + 1, LF) ? 2 : 1)
  s.cell += s.text[s.i]
  s.i++
}

function stepQuoted(s: State): void {
  const c = s.text.charCodeAt(s.i)
  if (c === QUOTE) return closeOrEscapeQuote(s)
  if (c === LF) { s.cell += '\n'; s.line++; s.i++; return }
  if (c === CR) { s.cell += '\n'; s.line++; s.i += isCharAt(s, s.i + 1, LF) ? 2 : 1; return }
  s.cell += s.text[s.i]
  s.i++
}

function closeOrEscapeQuote(s: State): void {
  if (isCharAt(s, s.i + 1, QUOTE)) { s.cell += '"'; s.i += 2; return }
  s.inQuotes = false
  s.i++
}

function endRecordAt(s: State, advance: number): void {
  pushCell(s)
  emitRecord(s, false)
  s.line++
  s.recordStartLine = s.line
  s.i += advance
}

function finalizeAtEof(s: State): void {
  if (s.inQuotes) { pushCell(s); emitRecord(s, true); return }
  if (s.cellStarted || s.cells.length > 0) { pushCell(s); emitRecord(s, false) }
}

function pushCell(s: State): void {
  s.cells.push(s.cell)
  s.lastCellWasQuoted = s.quotedCell
  s.cell = ''
  s.cellStarted = false
  s.quotedCell = false
}

function emitRecord(s: State, unterminated: boolean): void {
  const isBlank =
    !unterminated && s.cells.length === 1 && !s.lastCellWasQuoted && s.cells[0].trim() === ''
  if (!isBlank) s.records.push({ line: s.recordStartLine, cells: s.cells, unterminated })
  s.cells = []
}

/** Blanks skipped before an opening quote — includes the two non-ASCII spaces
 *  HK IMEs and zh-HK Excel emit, so `\u3000"陳, 大文"` still reads as quoted. */
function isLeadingBlank(c: number): boolean {
  return c === SPACE || c === TAB || c === NBSP || c === IDEOGRAPHIC_SPACE
}

function isCharAt(s: State, idx: number, code: number): boolean {
  return idx < s.len && s.text.charCodeAt(idx) === code
}
