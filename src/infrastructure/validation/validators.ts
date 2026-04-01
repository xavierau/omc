const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email)
}

export function isValidSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > 50) return false
  return SLUG_REGEX.test(slug)
}

export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id)
}

export function validateRequired(
  value: unknown,
  fieldName: string
): void {
  if (!value) {
    throw new Error(`${fieldName} is required`)
  }
}
