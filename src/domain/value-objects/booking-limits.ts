/**
 * BOOK-010 (plan D4, spec S1): a restaurant's guest limits,
 * `booking_config.bookingHours.limits = {perSlot, perMeal}`. Counted in
 * guests (party sizes), per date: `perSlot` = guests arriving at one slot
 * time, `perMeal` = guests across one period's slots. `null` (or the field
 * absent) = no limit, so a restaurant without limits behaves as BOOK-009
 * (spec AC-3). Whole numbers 1–999; when both are set, perSlot ≤ perMeal.
 */
export interface BookingLimits {
  perSlot: number | null
  perMeal: number | null
}

export const GUEST_LIMIT_MIN = 1
export const GUEST_LIMIT_MAX = 999
export const NO_LIMITS: BookingLimits = { perSlot: null, perMeal: null }

const LIMIT_FIELDS = ['perSlot', 'perMeal'] as const

export const isGuestLimit = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= GUEST_LIMIT_MIN && v <= GUEST_LIMIT_MAX

const asRecord = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null)

/** Field by field (never throws): a value out of range resolves to no limit. Absent → undefined. */
export function resolveBookingLimits(raw: unknown): BookingLimits | undefined {
  const r = asRecord(raw)
  if (!r) return undefined
  return { perSlot: isGuestLimit(r.perSlot) ? r.perSlot : null, perMeal: isGuestLimit(r.perMeal) ? r.perMeal : null }
}

/**
 * Spec AC-2: a settings save. `report(path, code)` gets each problem, path
 * relative to `limits` ('' = the object): `invalid` (0, negative, decimal,
 * text, above 999), `above_meal` on perSlot when it exceeds perMeal,
 * `unknown_field:<key>`. null or '' = no limit. Absent → undefined (kept off).
 */
export function parseBookingLimits(raw: unknown, report: (path: string, code: string) => void): BookingLimits | undefined {
  if (raw === undefined) return undefined
  const r = asRecord(raw)
  if (!r) return report('', 'invalid'), undefined
  const unknown = Object.keys(r).find((k) => !(LIMIT_FIELDS as readonly string[]).includes(k))
  if (unknown) return report('', `unknown_field:${unknown}`), undefined
  const limits: BookingLimits = { ...NO_LIMITS }
  for (const field of LIMIT_FIELDS) {
    const v = r[field]
    if (v === undefined || v === null || v === '') continue
    if (isGuestLimit(v)) limits[field] = v
    else report(field, 'invalid')
  }
  if (limits.perSlot !== null && limits.perMeal !== null && limits.perSlot > limits.perMeal) report('perSlot', 'above_meal')
  return limits
}

/** The limits that apply; no limits when unset. */
export function limitsOf(hours: { limits?: BookingLimits } | null | undefined): BookingLimits {
  return hours?.limits ?? NO_LIMITS
}

export const hasLimits = (limits: BookingLimits) => limits.perSlot !== null || limits.perMeal !== null
