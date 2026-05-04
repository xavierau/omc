// WAQ-006: Meta `account_quality_update` webhook handler.
// Mirrors the WAQ-002 status flow: claim-then-process idempotency, then
// persist a transition row to `tenant_quality_state`. Auto-pause /
// alerting / dashboards read this table downstream (WAQ-009/012/013).
//
// IDEMPOTENCY CONTRACT — same posture as WAQ-002:
//   - 'duplicate'  -> return (Kapso replay no-op)
//   - 'error'      -> throw idempotency.error so route.ts returns 500 and
//                     Kapso retries (a transient DB blip must not lose the
//                     transition).
//
// IDEMPOTENCY KEY — payload-derived (NOT clock-derived). Earlier versions
// used `roundedNowIso()` which broke on Kapso retries that arrived more
// than one second apart (different keys -> duplicate row). The hash below
// fingerprints the *meaningful* content of the transition: current state
// + old/previous state + identifier. Same payload twice -> same key
// (idempotent). Distinct transitions (GREEN -> YELLOW vs YELLOW -> GREEN)
// -> distinct keys because the OLD state differs.
//
// Trade-off: a tenant cycling YELLOW -> GREEN -> YELLOW *with the same old_*
// values both times collapses to one row. Including old_limit /
// previous_quality_score makes that vanishingly unlikely in practice.
//
// PER-TENANT SCOPE: `restaurantId` is part of the hash so two restaurants
// receiving identical webhook payloads (e.g. `message_template_quality_update`
// without `phone_number_id`) generate DIFFERENT keys. The `processed_webhooks`
// table is a global namespace — without this, tenant B's event would be
// silently dropped as a duplicate of tenant A's. The key prefix likewise
// falls back to `restaurant:<id>` (not the literal 'unknown') so the
// human-readable key remains tenant-scoped for audits.

import crypto from 'crypto'
import { tryMarkProcessed } from '@/infrastructure/supabase/idempotency'
import { insertEvent } from '@/infrastructure/supabase/repositories/quality-state-repository'
import { extractQualityEvent } from '@/infrastructure/whatsapp/webhooks'
import type { QualityWebhookEntry } from '@/infrastructure/whatsapp/webhooks'
import { QualityStateEvent } from '@/domain/entities/quality-state-event'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

const IDEMPOTENCY_ERROR_PREFIX = 'idempotency.error'

export async function routeQualityEvent(
  body: unknown,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  const events = extractQualityEvent(body)
  log('info', 'webhook.quality_event_count', { count: events.length })
  if (events.length === 0) {
    log('info', 'webhook.quality_event_ignored', { reason: 'no quality entries' })
    return
  }
  for (const entry of events) {
    await handleQualityEntry(entry, restaurantId, log)
  }
}

async function handleQualityEntry(
  entry: QualityWebhookEntry,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  const idempotencyKey = buildIdempotencyKey(restaurantId, entry)
  const claim = await tryMarkProcessed(idempotencyKey, log)
  if (claim === 'duplicate') return
  if (claim === 'error') {
    throw new Error(`${IDEMPOTENCY_ERROR_PREFIX} claim_failed key=${idempotencyKey}`)
  }
  const event = buildEvent({ entry, restaurantId, transitionedAt: nowIso() })
  await insertEvent(event)
  log('info', 'webhook.quality_event', {
    qualityRating: entry.qualityRating,
    messagingTier: entry.messagingTier,
    flagged: entry.flagged,
  })
}

/**
 * Constructs the persisted entity. When neither phone identifier is on the
 * payload (e.g. `message_template_quality_update`), we synthesise
 * `restaurant:<restaurantId>` so the row keeps a non-null phoneNumberId AND
 * is unique per tenant — better than the global literal 'unknown'.
 */
function buildEvent(args: {
  entry: QualityWebhookEntry
  restaurantId: string
  transitionedAt: string
}): QualityStateEvent {
  const { entry, restaurantId, transitionedAt } = args
  const fallbackId =
    !entry.phoneNumberId && !entry.displayPhoneNumber
      ? `restaurant:${restaurantId}`
      : null
  return QualityStateEvent.fromWebhook({
    id: crypto.randomUUID(),
    restaurantId,
    phoneNumberId: entry.phoneNumberId ?? fallbackId,
    displayPhoneNumber: entry.displayPhoneNumber,
    qualityRating: entry.qualityRating,
    messagingTier: entry.messagingTier,
    flagged: entry.flagged,
    rawPayload: entry.raw,
    transitionedAt,
  })
}

/**
 * Builds a stable, payload-derived, per-tenant idempotency key.
 *
 * `restaurantId` is included in the hash AND in the human-readable key
 * prefix so two restaurants receiving structurally identical webhooks
 * (e.g. `message_template_quality_update` without `phone_number_id`)
 * cannot collide on the global `processed_webhooks.idempotency_key`.
 *
 * The hash (SHA-256, truncated 16 hex) fingerprints:
 *   - restaurantId (per-tenant scoping)
 *   - phoneNumberId / displayPhoneNumber
 *   - current quality + tier + flagged
 *   - old_limit / previous_quality_score / message_template_id from the
 *     raw Meta payload (when present) — distinguishes back-to-back
 *     transitions through the same intermediate state.
 *
 * Key shape: `account_quality:<keyPrefix>:<sha256_16>` where keyPrefix is
 * `phoneNumberId` > `displayPhoneNumber` > `restaurant:<restaurantId>`.
 */
function buildIdempotencyKey(
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

function nowIso(): string {
  return new Date().toISOString()
}
