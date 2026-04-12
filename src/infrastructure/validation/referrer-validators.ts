import { isValidEmail, isValidUUID } from './validators'
import { isValidCommissionRate } from '@/domain/value-objects/commission-rate'

export class ReferrerValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferrerValidationError'
  }
}

export function validateCreateReferrer(
  body: Record<string, unknown>
): void {
  validateName(body.name)
  validateEmail(body.contactEmail)
  if (body.contactPhone != null) {
    validateContactPhone(body.contactPhone)
  }
  if (body.commissionPerMessageHkd != null) {
    validateCommission(body.commissionPerMessageHkd)
  }
}

export function validateUpdateReferrer(
  id: string,
  body: Record<string, unknown>
): void {
  if (!isValidUUID(id)) {
    throw new ReferrerValidationError('Invalid referrer ID')
  }
  if (body.name !== undefined) validateName(body.name)
  if (body.contactEmail !== undefined) validateEmail(body.contactEmail)
  if (body.contactPhone != null) {
    validateContactPhone(body.contactPhone)
  }
  if (body.commissionPerMessageHkd != null) {
    validateCommission(body.commissionPerMessageHkd)
  }
  if (body.status !== undefined) {
    const valid = ['active', 'inactive']
    if (!valid.includes(body.status as string)) {
      throw new ReferrerValidationError(
        'status must be "active" or "inactive"'
      )
    }
  }
}

function validateName(value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ReferrerValidationError('name is required')
  }
  if (value.length > 100) {
    throw new ReferrerValidationError(
      'name must be 100 characters or fewer'
    )
  }
}

function validateEmail(value: unknown): void {
  if (typeof value !== 'string' || !isValidEmail(value)) {
    throw new ReferrerValidationError('Invalid email format')
  }
}

function validateContactPhone(value: unknown): void {
  if (typeof value !== 'string' || value.length > 50) {
    throw new ReferrerValidationError(
      'contactPhone must be a string of 50 characters or fewer'
    )
  }
}

function validateCommission(value: unknown): void {
  if (typeof value !== 'number' || !isValidCommissionRate(value)) {
    throw new ReferrerValidationError(
      'commissionPerMessageHkd must be between 0 and 1'
    )
  }
}
