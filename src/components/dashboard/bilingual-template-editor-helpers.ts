/**
 * Pure state helpers extracted from `bilingual-template-editor.tsx` so they
 * can be unit-tested without a DOM. Keeps the component a thin JSX wrapper.
 */
import { insertAtCursor } from '@/domain/onboarding/onboarding-settings'

export type TabKey = 'en' | 'zhHk'

export interface BilingualValue {
  en: string
  zhHk: string
}

export interface InsertResult {
  value: BilingualValue
  cursor: number
}

const WARN_RATIO = 0.9

/**
 * Insert `token` into the active tab's text at `cursor`. Returns the updated
 * bilingual value and the next cursor position. The inactive tab is untouched.
 * Returns `null` when the resulting active tab would exceed `maxLength`.
 */
export function insertIntoActiveTab(
  value: BilingualValue,
  active: TabKey,
  cursor: number,
  token: string,
  maxLength: number = Number.POSITIVE_INFINITY
): InsertResult | null {
  const current = value[active]
  const result = insertAtCursor(current, cursor, token)
  if (result.value.length > maxLength) return null
  return {
    value: { ...value, [active]: result.value },
    cursor: result.cursor,
  }
}

export function isTabWarning(length: number, maxLength: number): boolean {
  return length > Math.floor(maxLength * WARN_RATIO)
}
