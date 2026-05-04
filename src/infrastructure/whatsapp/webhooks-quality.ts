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
  // Meta's `phone_number_quality_update` event ships ONLY the
  // `display_phone_number` (e.g. "85291234567") — no `phone_number_id`.
  // We expose it separately so the resolver can fall back when the id is
  // missing, and so the persistence layer records whichever identifier
  // was actually present.
  displayPhoneNumber: string | null
  qualityRating: QualityRating
  messagingTier: string | null
  flagged: boolean
  raw: Record<string, unknown>
}

export function hasMetaQuality(obj: Record<string, unknown>): boolean {
  return allChanges(obj).some(
    (c) => typeof c.field === 'string' && QUALITY_FIELDS.has(c.field)
  )
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
  // Meta can batch multiple `entry[].changes[]` per webhook (e.g. two
  // template quality updates and one account quality update in the same
  // POST). Iterate over every quality-bearing change so none are silently
  // dropped.
  return allChanges(obj)
    .filter(
      (c) => typeof c.field === 'string' && QUALITY_FIELDS.has(c.field as string)
    )
    .map((c) => toQualityEntry((c.value ?? {}) as Record<string, unknown>))
}

function extractKapsoFlatQuality(
  obj: Record<string, unknown>
): QualityWebhookEntry | null {
  if (obj.event !== 'account_quality_update') return null
  const data = (obj.data as Record<string, unknown> | undefined) ?? obj
  return toQualityEntry(data)
}

function allChanges(
  obj: Record<string, unknown>
): Array<Record<string, unknown>> {
  const entries = Array.isArray(obj.entry) ? obj.entry : []
  const out: Array<Record<string, unknown>> = []
  for (const entry of entries) {
    const e = entry as Record<string, unknown> | undefined
    const changes = Array.isArray(e?.changes) ? (e!.changes as unknown[]) : []
    for (const change of changes) {
      if (change && typeof change === 'object') {
        out.push(change as Record<string, unknown>)
      }
    }
  }
  return out
}

function toQualityEntry(
  value: Record<string, unknown>
): QualityWebhookEntry {
  return {
    phoneNumberId: readString(value.phone_number_id) ?? null,
    displayPhoneNumber: readString(value.display_phone_number) ?? null,
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
