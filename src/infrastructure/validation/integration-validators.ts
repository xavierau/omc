import type { PosFieldMapping } from '@/domain/value-objects/pos-field-mapping'

const ALLOWED_PATCH_FIELDS = ['name', 'status', 'fieldMapping', 'credentials'] as const
type AllowedPatchField = (typeof ALLOWED_PATCH_FIELDS)[number]

export interface ParsedIntegrationPatch {
  name?: string
  status?: 'active' | 'inactive'
  fieldMapping?: PosFieldMapping
  credentials?: Record<string, unknown>
}

export type IntegrationPatchResult =
  | { ok: true; data: ParsedIntegrationPatch }
  | { ok: false; error: 'unknown_field'; field: string }
  | { ok: false; error: 'invalid_body' | 'invalid_name' | 'invalid_status' | 'invalid_credentials' }

function isAllowedField(key: string): key is AllowedPatchField {
  return (ALLOWED_PATCH_FIELDS as readonly string[]).includes(key)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Hand-rolled PATCH allowlist (repo has no zod). `webhook_secret` — and any
 * other key not in ALLOWED_PATCH_FIELDS, including `restaurantId` — is
 * rejected outright rather than silently dropped, so a caller finds out
 * their patch did nothing instead of assuming a field it sent took effect
 * (T-C4).
 */
export function parseIntegrationPatch(body: unknown): IntegrationPatchResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'invalid_body' }
  }

  for (const key of Object.keys(body)) {
    if (!isAllowedField(key)) {
      return { ok: false, error: 'unknown_field', field: key }
    }
  }

  const data: ParsedIntegrationPatch = {}

  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return { ok: false, error: 'invalid_name' }
    }
    data.name = body.name
  }

  if ('status' in body) {
    if (body.status !== 'active' && body.status !== 'inactive') {
      return { ok: false, error: 'invalid_status' }
    }
    data.status = body.status
  }

  if ('fieldMapping' in body) {
    // Structural validation (required sub-fields) happens downstream in
    // updateIntegration via validateFieldMapping — this layer only enforces
    // the field allowlist.
    data.fieldMapping = body.fieldMapping as PosFieldMapping
  }

  if ('credentials' in body) {
    if (!isPlainObject(body.credentials)) {
      return { ok: false, error: 'invalid_credentials' }
    }
    data.credentials = body.credentials
  }

  return { ok: true, data }
}
