import { Language } from '@/domain/value-objects/language'

/**
 * Parse an explicit language-switch command. Recognised forms:
 *
 *   - ASCII (case-insensitive):  `LANG EN`, `LANG ZH`
 *   - Traditional Chinese:       `語言 英文`, `語言 中文`
 *
 * Whitespace is trimmed and collapsed before matching. Anything else
 * (empty, null, `LANG FR`, `LANG` alone, arbitrary text) returns null so
 * callers can fall through to normal routing.
 *
 * Kept pure (no IO) so the command grammar can be unit-tested exhaustively
 * and reused from any layer.
 */
export function parseLanguageCommand(
  text: string | null | undefined
): Language | null {
  if (text == null) return null
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length === 0) return null

  const upper = normalized.toUpperCase()
  if (upper === 'LANG EN') return Language.EN
  if (upper === 'LANG ZH') return Language.ZH_HK

  // CJK branch: compare against trimmed (non-uppercased) input — case-insensitivity doesn't apply to CJK characters
  if (normalized === '語言 英文') return Language.EN
  if (normalized === '語言 中文') return Language.ZH_HK

  return null
}
