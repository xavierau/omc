// WAQ-006: quality-event classification + extraction helpers.
// Meta forwards three relevant fields:
//   - account_update (event: 'account_quality_update')
//   - phone_number_quality_update
//   - message_template_quality_update
// Kapso may also wrap them as a flat `event: 'account_quality_update'`.
// We read both shapes defensively — field names have changed across Meta API
// versions so each reader tries multiple keys.

import {
  isQualityRating,
  type QualityRating,
} from '@/domain/value-objects/quality-rating'

const QUALITY_FIELDS = new Set([
  'account_update',
  'phone_number_quality_update',
  'message_template_quality_update',
])

export interface QualityWebhookEntry {
  phoneNumberId: string | null
  qualityRating: QualityRating
  messagingTier: string | null
  flagged: boolean
  raw: Record<string, unknown>
}

export function hasMetaQuality(obj: Record<string, unknown>): boolean {
  const change = firstChange(obj)
  const field = typeof change?.field === 'string' ? change.field : null
  return field !== null && QUALITY_FIELDS.has(field)
}

export function hasKapsoFlatQuality(obj: Record<string, unknown>): boolean {
  return obj.event === 'account_quality_update'
}

export function extractQualityEvent(body: unknown): QualityWebhookEntry[] {
  if (!body || typeof body !== 'object') return []
  const obj = body as Record<string, unknown>
  const fromMeta = extractMetaQuality(obj)
  if (fromMeta.length > 0) return fromMeta
  const fromKapso = extractKapsoFlatQuality(obj)
  return fromKapso ? [fromKapso] : []
}

function extractMetaQuality(
  obj: Record<string, unknown>
): QualityWebhookEntry[] {
  const change = firstChange(obj)
  if (!change || typeof change.field !== 'string') return []
  if (!QUALITY_FIELDS.has(change.field)) return []
  const value = (change.value ?? {}) as Record<string, unknown>
  return [toQualityEntry(value)]
}

function extractKapsoFlatQuality(
  obj: Record<string, unknown>
): QualityWebhookEntry | null {
  if (obj.event !== 'account_quality_update') return null
  const data = (obj.data as Record<string, unknown> | undefined) ?? obj
  return toQualityEntry(data)
}

function firstChange(
  obj: Record<string, unknown>
): Record<string, unknown> | null {
  const entries = Array.isArray(obj.entry) ? obj.entry : []
  const entry = entries[0] as Record<string, unknown> | undefined
  const changes = Array.isArray(entry?.changes) ? entry!.changes : []
  return (changes[0] as Record<string, unknown> | undefined) ?? null
}

function toQualityEntry(
  value: Record<string, unknown>
): QualityWebhookEntry {
  return {
    phoneNumberId: readString(value.phone_number_id) ?? null,
    qualityRating: readQualityRating(value),
    messagingTier:
      readString(value.current_limit) ?? readString(value.tier) ?? null,
    flagged: readFlagged(value),
    raw: value,
  }
}

function readQualityRating(value: Record<string, unknown>): QualityRating {
  // Meta sends lowercase quality on account_update, uppercase for template
  // quality scores. Normalise to upper-case before validating.
  const candidates = [
    value.quality,
    value.new_quality_score,
    value.quality_score,
  ]
  for (const c of candidates) {
    if (typeof c !== 'string') continue
    const upper = c.toUpperCase()
    if (isQualityRating(upper)) return upper
  }
  return 'UNKNOWN'
}

function readFlagged(value: Record<string, unknown>): boolean {
  if (typeof value.flagged === 'boolean') return value.flagged
  // Meta phone_number_quality_update sends event === 'FLAGGED' or 'UNFLAGGED'.
  if (value.event === 'FLAGGED') return true
  return false
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
