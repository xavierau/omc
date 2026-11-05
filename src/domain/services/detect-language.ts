import { Language } from '@/domain/value-objects/language'

const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const LATIN_LETTER = /\p{Script=Latin}/u

/**
 * Pure, script-based language detection for short WhatsApp inbound text.
 *
 *   - Any Han / Hiragana / Katakana code point → ZH_HK (HK market default CJK).
 *   - Otherwise any Latin-script letter → EN.
 *   - Anything else (digits, symbols, emoji, Cyrillic, Arabic, Thai, Korean,
 *     whitespace, empty, null) → null.
 *
 * Returning `null` lets callers skip persistence and fall through to the
 * restaurant default at send-time. Intentionally conservative: a signal we
 * can't read is better stored as "unknown" than guessed.
 */
export function detectLanguageFromText(
  text: string | null | undefined
): Language | null {
  if (text == null) return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  if (CJK_SCRIPT.test(trimmed)) return Language.ZH_HK
  if (LATIN_LETTER.test(trimmed)) return Language.EN
  return null
}
