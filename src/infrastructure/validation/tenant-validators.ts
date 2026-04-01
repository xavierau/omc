import { isValidEmail, isValidSlug, isValidUUID } from './validators'

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function validateCreateTenant(body: Record<string, unknown>): void {
  validateName(body.name)
  validateSlug(body.slug)
  validateStringField(body.whatsappNumber, 'whatsappNumber')
  validateStringField(body.kapsoPhoneNumberId, 'kapsoPhoneNumberId')
  validateEmail(body.adminEmail)
  validatePassword(body.adminPassword)
}

export function validateUpdateTenant(
  id: string,
  body: Record<string, unknown>
): void {
  if (!isValidUUID(id)) throw new ValidationError('Invalid tenant ID')
  if (body.name !== undefined) validateName(body.name)
  if (body.status !== undefined) {
    const valid = ['active', 'inactive', 'trial']
    if (!valid.includes(body.status as string)) {
      throw new ValidationError('status must be "active", "inactive", or "trial"')
    }
  }
}

export function validateAddUser(body: Record<string, unknown>): void {
  validateEmail(body.email)
  validatePassword(body.password)
  if (body.role && body.role !== 'admin' && body.role !== 'staff') {
    throw new ValidationError('role must be "admin" or "staff"')
  }
}

function validateName(value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError('name is required')
  }
  if (value.length > 100) {
    throw new ValidationError('name must be 100 characters or fewer')
  }
}

function validateSlug(value: unknown): void {
  if (typeof value !== 'string' || !isValidSlug(value)) {
    throw new ValidationError(
      'slug must be lowercase alphanumeric with hyphens, max 50 chars'
    )
  }
}

function validateEmail(value: unknown): void {
  if (typeof value !== 'string' || !isValidEmail(value)) {
    throw new ValidationError('Invalid email format')
  }
}

function validatePassword(value: unknown): void {
  if (typeof value !== 'string' || value.length < 8) {
    throw new ValidationError('Password must be at least 8 characters')
  }
}

function validateStringField(value: unknown, name: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${name} is required`)
  }
}
