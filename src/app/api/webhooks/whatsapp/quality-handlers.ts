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
  // Meta does not include a per-event timestamp on account_update payloads,
  // so we fall back to Date.now() rounded to the second. Two retries within
  // the same second collapse via idempotency (correct); two distinct
  // transitions in different seconds get distinct keys (also correct).
  const transitionedAt = roundedNowIso()
  const phoneNumberId = entry.phoneNumberId ?? 'unknown'
  const idempotencyKey = `account_quality:${phoneNumberId}:${transitionedAt}`

  const claim = await tryMarkProcessed(idempotencyKey, log)
  if (claim === 'duplicate') return
  if (claim === 'error') {
    throw new Error(`${IDEMPOTENCY_ERROR_PREFIX} claim_failed key=${idempotencyKey}`)
  }

  const event = QualityStateEvent.fromWebhook({
    id: crypto.randomUUID(),
    restaurantId,
    phoneNumberId,
    qualityRating: entry.qualityRating,
    messagingTier: entry.messagingTier,
    flagged: entry.flagged,
    rawPayload: entry.raw,
    transitionedAt,
  })

  await insertEvent(event)
  log('info', 'webhook.quality_event', {
    qualityRating: entry.qualityRating,
    messagingTier: entry.messagingTier,
    flagged: entry.flagged,
  })
}

function roundedNowIso(): string {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()
}
