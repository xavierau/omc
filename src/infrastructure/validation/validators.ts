const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHONE_E164_REGEX = /^\+?[0-9]{8,15}$/

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email)
}

export function isValidPhoneE164(value: string): boolean {
  return PHONE_E164_REGEX.test(value)
}

export function isValidSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > 50) return false
  return SLUG_REGEX.test(slug)
}

export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id)
}

/**
 * True for an array whose every element is a UUID string.
 *
 * Route bodies must check this rather than leave it to Postgres: a malformed
 * id reaches PostgREST as `invalid input syntax for type uuid`, which a
 * catch-all reports as a 500 for what is really bad client input (M-8). An
 * empty array passes — emptiness is each caller's own policy.
 */
export function isUuidArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((v) => typeof v === 'string' && isValidUUID(v))
  )
}

export function validateRequired(
  value: unknown,
  fieldName: string
): void {
  if (!value) {
    throw new Error(`${fieldName} is required`)
  }
}
