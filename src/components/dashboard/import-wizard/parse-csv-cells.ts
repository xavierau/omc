/**
 * Cell-level normalisation for parse-csv.ts, split out to keep the parser
 * under the file-size limit. Pure string functions, no imports.
 */

export function cellOrNull(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normaliseLang(value: string | undefined): 'en' | 'zh_hk' | null {
  if (!value) return null
  const lower = value.trim().toLowerCase()
  if (lower === 'en') return 'en'
  if (lower === 'zh_hk' || lower === 'zh-hk') return 'zh_hk'
  return null
}

/** Rejects carry the phone only when it looks like one: a swallowed multi-line
 *  cell (unterminated quote opened in the phone column) would otherwise put the
 *  rest of the file into the rejections panel. */
const MAX_REJECT_PHONE_LEN = 32

export function rejectPhone(value: string | undefined): string | null {
  const phone = cellOrNull(value)
  if (!phone || phone.length > MAX_REJECT_PHONE_LEN || /[\r\n]/.test(phone)) return null
  return phone
}

/** A quoted cell may legitimately contain a line break (Excel Alt+Enter). A name
 *  is one line: collapse any whitespace run to a single space — a newline in
 *  `members.name` later reaches a WhatsApp template parameter, where Meta
 *  rejects it. */
export function collapseWhitespace(value: string | null): string | null {
  return value ? value.replace(/\s+/g, ' ') : null
}

/** In the tags cell a line break separates tags like `;` does; a tag name with
 *  an embedded newline would otherwise be minted verbatim (#148's junk-tag
 *  class via a new vector). */
export function newlinesToTagSeparators(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.replace(/\r?\n|\r/g, ';')
}
