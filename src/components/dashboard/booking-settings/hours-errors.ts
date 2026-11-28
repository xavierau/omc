/**
 * BOOK-009 (spec AC-2, UI Feedback States): the PUT's per-path error codes
 * (W1: `bookingHours.weekly.wed.0`, `bookingHours.special.2026-12-24`,
 * `bookingHours.special.3`, `bookingHours.terms.en`, `bookingHours.info.mapUrl`)
 * found for the row or field they belong to.
 */
import type { Weekday } from '@/domain/value-objects/booking-hours'

export type SettingsErrors = Record<string, string>

const P = 'bookingHours'

export interface RowError {
  code: string
  /** The period it is about, when the error names one. */
  period: number | null
}

/** The first error under any of the given prefixes: the key itself or `<key>.<n>`. */
function rowError(errors: SettingsErrors, keys: string[]): RowError | null {
  for (const key of keys) {
    if (errors[key]) return { code: errors[key], period: null }
    const nested = Object.keys(errors).find((k) => k.startsWith(`${key}.`) && /^\d+$/.test(k.slice(key.length + 1)))
    if (nested) return { code: errors[nested], period: Number(nested.slice(key.length + 1)) }
  }
  return null
}

export const dayError = (errors: SettingsErrors, day: Weekday) => rowError(errors, [`${P}.weekly.${day}`])

/** Whether a weekly period has its own error (the row outlines that period). */
export const periodHasError = (errors: SettingsErrors, day: Weekday, index: number) => Boolean(errors[`${P}.weekly.${day}.${index}`])

/** A special date's error, keyed by its date, or by its list index when the date itself was bad. */
export function specialError(errors: SettingsErrors, date: string, index: number): string | null {
  return errors[`${P}.special.${date}`] ?? errors[`${P}.special.${index}`] ?? null
}

export const fieldError = (errors: SettingsErrors, path: string): string | null => errors[`${P}.${path}`] ?? null

/** Errors with no row of their own (the whole value, the weekly table, the list). */
export function blockError(errors: SettingsErrors): string | null {
  return errors[P] ?? errors[`${P}.weekly`] ?? errors[`${P}.special`] ?? null
}

/** "Not saved: N to fix" counts every field the server refused. */
export const errorCount = (errors: SettingsErrors) => Object.keys(errors).length
