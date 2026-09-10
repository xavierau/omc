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
// Idempotency-key construction lives in `quality-idempotency.ts` to keep
// this file under the 150-line ceiling. WAQ-009 wires the dispatcher
// AFTER the row is persisted.

import crypto from 'crypto'
import { tryMarkProcessed } from '@/infrastructure/supabase/idempotency'
import {
  insertEvent,
  findLatest,
} from '@/infrastructure/supabase/repositories/quality-state-repository'
import { extractQualityEvent } from '@/infrastructure/whatsapp/webhooks'
import type { QualityWebhookEntry } from '@/infrastructure/whatsapp/webhooks'
import { QualityStateEvent } from '@/domain/entities/quality-state-event'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'
import { dispatchQualityAction } from '@/application/dispatch-quality-action'
import { buildQualityIdempotencyKey } from './quality-idempotency'

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
  const idempotencyKey = buildQualityIdempotencyKey(restaurantId, entry)
  const claim = await tryMarkProcessed(idempotencyKey, log)
  if (claim === 'duplicate') return
  if (claim === 'error') {
    throw new Error(`${IDEMPOTENCY_ERROR_PREFIX} claim_failed key=${idempotencyKey}`)
  }
  // WAQ-009 r1 review: prefer Meta's payload event time over server `now`.
  // Server time always advances, so a delayed retry would get a NEWER
  // timestamp than the current DB row and the stale guard would never
  // trigger. Meta's `entry[].time` (or value.event_time / value.timestamp)
  // is the only signal that actually orders out-of-band webhooks.
  const transitionedAt = entry.eventTimestamp ?? new Date().toISOString()
  // Read PRIOR state BEFORE inserting so the dispatcher sees the true
  // previous rating (not the row we are about to insert).
  const prev = await findLatest({ restaurantId })
  const event = buildEvent({ entry, restaurantId, transitionedAt })
  await insertEvent(event)
  log('info', 'webhook.quality_event', {
    qualityRating: entry.qualityRating,
    messagingTier: entry.messagingTier,
    flagged: entry.flagged,
  })
  await maybeDispatchAction({ entry, prev, restaurantId, transitionedAt, log })
}

interface DispatchInput {
  entry: QualityWebhookEntry
  prev: QualityStateEvent | null
  restaurantId: string
  transitionedAt: string
  log: LogFn
}

/**
 * Stale-event guard: out-of-order webhooks (Kapso re-sends an OLDER event
 * after a NEWER one) must not regress tenant state. We compare
 * transitioned_at against the most recent persisted row.
 */
async function maybeDispatchAction(input: DispatchInput): Promise<void> {
  const { entry, prev, restaurantId, transitionedAt, log } = input
  if (prev && prev.snapshot.transitionedAt > transitionedAt) {
    log('info', 'webhook.quality_action_skipped_stale', {
      restaurantId,
      prevAt: prev.snapshot.transitionedAt,
      thisAt: transitionedAt,
    })
    return
  }
  await dispatchQualityAction({
    restaurantId,
    prevRating: prev?.snapshot.qualityRating ?? null,
    nextRating: entry.qualityRating,
    log,
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
