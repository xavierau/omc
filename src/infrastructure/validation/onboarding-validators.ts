// WONB-001: route-layer validators for the onboarding API surface. Reuses
// the ValidationError class from tenant-validators so handleError mappings
// stay uniform across admin routes.

import {
  isOnboardingPath,
  type OnboardingPath,
} from '@/domain/value-objects/onboarding-path'
import {
  isChecklistKey,
  type ChecklistKey,
} from '@/domain/value-objects/pre-kickoff-checklist'
import { ValidationError } from './tenant-validators'

export { ValidationError }

export function validatePath(value: unknown): OnboardingPath {
  if (!isOnboardingPath(value)) {
    throw new ValidationError("path must be one of 'A', 'B1', 'B2', 'B3'")
  }
  return value
}

export interface ChecklistMutation {
  key: ChecklistKey
  checked: boolean
}

export function validateChecklistKey(body: unknown): ChecklistMutation {
  const obj = asRecord(body)
  if (!isChecklistKey(obj.key)) {
    throw new ValidationError('key must be a known checklist key')
  }
  if (typeof obj.checked !== 'boolean') {
    throw new ValidationError('checked must be a boolean')
  }
  return { key: obj.key, checked: obj.checked }
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object')
  }
  return body as Record<string, unknown>
}
