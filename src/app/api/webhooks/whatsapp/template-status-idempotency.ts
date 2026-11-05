// TPL-009 helper: payload-derived, per-tenant idempotency key builder for
// `message_template_status_update` webhooks. Mirrors quality-idempotency.ts
// (extracted for file-size hygiene); the key shape is part of the public
// webhook contract — DO NOT change the hash inputs without coordinating
// with `processed_webhooks` operators.
//
// The hash (SHA-256, truncated 16 hex) fingerprints:
//   - restaurantId (per-tenant scoping)
//   - metaTemplateId / templateName / language (identifies the template)
//   - event + reason (the transition itself)
//   - eventTimestamp — makes Kapso replays (same timestamp) dedupe while
//     legitimate re-transitions through the same state (approved -> paused
//     -> approved) stay distinct.
//
// Known, bounded gap: when eventTimestamp is absent the fingerprint cannot
// tell a replay from a genuine return to the same state, and the second
// transition is swallowed as a duplicate. Meta's envelope always carries
// `entry[].time`, so this only reaches the (unverified) Kapso-flat shape.
// It is left unfixed deliberately: a nonce would defeat replay protection
// outright, and the handler only ever writes cron-syncable statuses, so a
// swallowed transition is repaired by the next sync (≤15 min) rather than
// persisting.
//
// Key shape: `template_status:<keyPrefix>:<sha256_16>` where keyPrefix is
// `wabaId` > `restaurant:<restaurantId>`.

import crypto from 'crypto'
import type { TemplateStatusWebhookEntry } from '@/infrastructure/whatsapp/webhooks'

export function buildTemplateStatusIdempotencyKey(
  restaurantId: string,
  entry: TemplateStatusWebhookEntry
): string {
  const keyPrefix = entry.wabaId ?? `restaurant:${restaurantId}`
  const fingerprint = {
    restaurantId,
    metaTemplateId: entry.metaTemplateId ?? null,
    templateName: entry.templateName ?? null,
    language: entry.language ?? null,
    event: entry.event,
    reason: entry.reason ?? null,
    eventTimestamp: entry.eventTimestamp ?? null,
  }
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(fingerprint))
    .digest('hex')
    .slice(0, 16)
  return `template_status:${keyPrefix}:${hash}`
}
