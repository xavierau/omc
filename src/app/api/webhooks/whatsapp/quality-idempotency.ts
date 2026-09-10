// WAQ-006 helper: payload-derived, per-tenant idempotency key builder.
// Extracted from quality-handlers.ts purely for file-size hygiene; the key
// shape is part of the public webhook contract — DO NOT change the hash
// inputs without coordinating with `processed_webhooks` operators.
//
// The hash (SHA-256, truncated 16 hex) fingerprints:
//   - restaurantId (per-tenant scoping)
//   - phoneNumberId / displayPhoneNumber
//   - current quality + tier + flagged
//   - old_limit / previous_quality_score / message_template_id from the
//     raw Meta payload (when present) — distinguishes back-to-back
//     transitions through the same intermediate state.
//
// Key shape: `account_quality:<keyPrefix>:<sha256_16>` where keyPrefix is
// `phoneNumberId` > `displayPhoneNumber` > `restaurant:<restaurantId>`.

import crypto from 'crypto'
import type { QualityWebhookEntry } from '@/infrastructure/whatsapp/webhooks'

export function buildQualityIdempotencyKey(
  restaurantId: string,
  entry: QualityWebhookEntry
): string {
  const keyPrefix =
    entry.phoneNumberId ??
    entry.displayPhoneNumber ??
    `restaurant:${restaurantId}`
  const fingerprint = {
    restaurantId,
    phoneNumberId: entry.phoneNumberId ?? null,
    displayPhoneNumber: entry.displayPhoneNumber ?? null,
    qualityRating: entry.qualityRating,
    messagingTier: entry.messagingTier ?? null,
    flagged: entry.flagged,
    oldLimit: readString(entry.raw.old_limit) ?? null,
    previousQualityScore: readString(entry.raw.previous_quality_score) ?? null,
    messageTemplateId:
      readString(entry.raw.message_template_id) ??
      readString(entry.raw.template_id) ??
      null,
  }
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(fingerprint))
    .digest('hex')
    .slice(0, 16)
  return `account_quality:${keyPrefix}:${hash}`
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
