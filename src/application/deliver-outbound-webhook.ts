// INT-001 WI-6: `deliverOutboundWebhook` -- "the only code allowed to fetch
// a user URL" (via `OutboundWebhookSender`, T-C3). One attempt per call;
// the caller (the outbound processor, which owns the BullMQ `Job` object)
// decides how to turn the returned outcome into a BullMQ-level
// retry/delay/permanent-failure signal.
//
// Attempt procedure (plan §Outbound):
//   1. Load delivery + integration settings. Kill switch or
//      outbound_status != 'active' -> mark paused, return without error.
//   2. Materialise the payload from Postgres NOW (never from the job --
//      T-H7), via build-outbound-payload.ts.
//   3/4. Read the CURRENT decrypted secret and sign at attempt time
//      (T-M4) -- a rotation between enqueue and attempt lands on the new
//      secret automatically, since nothing about the signature is decided
//      until this point.
//   5. Classify (delivered / permanent / transient) and persist. Permanent
//      failures dead-letter + alert but do NOT touch the breaker streak
//      (T-M4's own point: a post-rotation dead-letter storm must not also
//      trip the breaker). Transient failures bump the streak; reaching
//      BREAKER_THRESHOLD flips the integration to `paused_auto` + alerts.

import { findDeliveryById, saveDelivery } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { findIntegrationEventById } from '@/infrastructure/supabase/repositories/integration-event-repository'
import {
  findIntegrationSettingsById,
  readOutboundSecret,
  updateOutboundBreakerState,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { getOutboundWebhookSender } from '@/infrastructure/http/outbound-sender-factory'
import { buildOutboundPayload } from '@/application/build-outbound-payload'
import { notifyOpsAlert } from '@/application/notify-ops-alert'
import { classifyDeliveryOutcome } from '@/domain/services/delivery-outcome'
import { signHmacSha256Hex } from '@/domain/services/webhook-signature'
import type { IntegrationDelivery } from '@/domain/entities/integration-delivery'
import type { IntegrationSettings } from '@/domain/entities/integration-settings'
import type { OutboundWebhookSender } from '@/domain/ports/outbound-webhook-sender'
import type { Clock } from '@/domain/ports/clock'

/** Spec US-6: "10 consecutive failures (default)". Hardcoded, not an env
 * var -- not in the plan's Integration Map env-var row (#22), and the
 * orchestrator's absence pass checks that list; adding an undocumented
 * knob would fail it silently. */
const BREAKER_THRESHOLD = 10

export type DeliverOutboundWebhookKind = 'delivered' | 'permanent' | 'transient' | 'paused'

export interface DeliverOutboundWebhookResult {
  kind: DeliverOutboundWebhookKind
  /** Only ever set on a `transient` result from a 429 the sender parsed a
   * plain-integer `Retry-After` out of -- the processor honours this via
   * `job.moveToDelayed()` instead of ordinary exponential backoff. */
  retryAfterSec?: number
}

export interface DeliverOutboundWebhookDeps {
  sender?: OutboundWebhookSender
  clock?: Clock
}

export async function deliverOutboundWebhook(
  deliveryId: string,
  attemptNumber: number,
  deps: DeliverOutboundWebhookDeps = {}
): Promise<DeliverOutboundWebhookResult> {
  const sender = deps.sender ?? getOutboundWebhookSender()
  const now = deps.clock?.now() ?? new Date()

  const delivery = await findDeliveryById(deliveryId)
  if (!delivery) {
    // The row is gone (should not happen outside a pruning race) -- there
    // is nothing left to retry against.
    return { kind: 'permanent' }
  }

  const settings = await findIntegrationSettingsById(delivery.snapshot.integrationId)
  const killSwitchOn = process.env.INT001_DISABLE_OUTBOUND === '1'
  if (killSwitchOn || !settings || settings.snapshot.outboundStatus !== 'active') {
    if (delivery.canTransitionTo('paused')) {
      await saveDelivery(delivery.transitionTo('paused'))
    }
    return { kind: 'paused' }
  }

  const event = await findIntegrationEventById(delivery.snapshot.eventId)
  if (!event) {
    await deadLetter(delivery, settings, now, { httpStatus: null, errorCode: 'event_not_found' })
    return { kind: 'permanent' }
  }

  const delivering = delivery.transitionTo('delivering')
  await saveDelivery(delivering)

  const payloadResult = await buildOutboundPayload(
    event,
    delivery.snapshot.restaurantId,
    delivery.snapshot.integrationId
  )
  if (!payloadResult.ok) {
    await deadLetter(delivering, settings, now, { httpStatus: null, errorCode: payloadResult.error.title })
    return { kind: 'permanent' }
  }

  const secret = await readOutboundSecret(delivery.snapshot.integrationId)
  if (!secret) {
    await deadLetter(delivering, settings, now, { httpStatus: null, errorCode: 'secret_missing' })
    return { kind: 'permanent' }
  }
  if (!settings.snapshot.outboundUrl) {
    await deadLetter(delivering, settings, now, { httpStatus: null, errorCode: 'url_missing' })
    return { kind: 'permanent' }
  }

  const t = Math.floor(now.getTime() / 1000).toString()
  const signature = signHmacSha256Hex(secret, `${t}.${payloadResult.body}`)
  const headers = {
    'X-OMC-Signature': `t=${t},v1=${signature}`,
    'X-OMC-Event-Id': event.id,
    'X-OMC-Delivery-Attempt': String(attemptNumber),
    'X-OMC-Event-Type': event.type,
    'Content-Type': 'application/json',
  }

  const result = await sender.send({ url: settings.snapshot.outboundUrl, body: payloadResult.body, headers })
  const outcome = classifyDeliveryOutcome(result)
  const attempts = delivery.snapshot.attempts + 1

  if (outcome === 'delivered') {
    await saveDelivery(
      delivering.transitionTo('delivered', {
        attempts,
        lastHttpStatus: result.status,
        lastErrorCode: null,
        lastLatencyMs: result.latencyMs,
        responseExcerpt: result.responseExcerpt,
        deliveredAt: now.toISOString(),
      })
    )
    if (settings.snapshot.outboundFailureStreak > 0) {
      await updateOutboundBreakerState({ integrationId: delivery.snapshot.integrationId, outboundFailureStreak: 0 })
    }
    return { kind: 'delivered' }
  }

  if (outcome === 'permanent') {
    await deadLetter(delivering, settings, now, {
      httpStatus: result.status,
      errorCode: result.error?.title ?? null,
      attempts,
      latencyMs: result.latencyMs,
      responseExcerpt: result.responseExcerpt,
    })
    return { kind: 'permanent' }
  }

  // Transient: T-M4 -- permanent failures never reach here, so the streak
  // only ever reflects genuine transient trouble reaching the destination.
  await saveDelivery(
    delivering.transitionTo('retrying', {
      attempts,
      lastHttpStatus: result.status,
      lastErrorCode: result.error?.title ?? null,
      lastLatencyMs: result.latencyMs,
      responseExcerpt: result.responseExcerpt,
    })
  )
  const streak = settings.snapshot.outboundFailureStreak + 1
  if (streak >= BREAKER_THRESHOLD) {
    await updateOutboundBreakerState({
      integrationId: delivery.snapshot.integrationId,
      outboundFailureStreak: streak,
      outboundStatus: 'paused_auto',
      outboundPausedAt: now.toISOString(),
    })
    await alertBreakerTripped(delivery.snapshot.integrationId, settings, streak)
  } else {
    await updateOutboundBreakerState({ integrationId: delivery.snapshot.integrationId, outboundFailureStreak: streak })
  }

  return { kind: 'transient', retryAfterSec: result.retryAfterSec }
}

async function deadLetter(
  delivery: IntegrationDelivery,
  settings: IntegrationSettings,
  now: Date,
  info: {
    httpStatus: number | null
    errorCode: string | null
    attempts?: number
    latencyMs?: number
    responseExcerpt?: string | null
  }
): Promise<void> {
  const next = delivery.canTransitionTo('dead_lettered')
    ? delivery
    : delivery.transitionTo('delivering')
  await saveDelivery(
    next.transitionTo('dead_lettered', {
      attempts: info.attempts ?? delivery.snapshot.attempts + 1,
      lastHttpStatus: info.httpStatus,
      lastErrorCode: info.errorCode,
      lastLatencyMs: info.latencyMs ?? delivery.snapshot.lastLatencyMs,
      responseExcerpt: info.responseExcerpt ?? null,
      deadLetteredAt: now.toISOString(),
    })
  )
  await alertDeadLettered(delivery.snapshot.integrationId, delivery.snapshot.eventId, settings, info)
}

/** T-L4: the Slack payload carries the event id, integration name, and
 * HTTP/error code ONLY -- never the request/response body (which may
 * contain the partner's own error text echoing back member data). */
async function alertDeadLettered(
  integrationId: string,
  eventId: string,
  settings: IntegrationSettings,
  info: { httpStatus: number | null; errorCode: string | null }
): Promise<void> {
  const integration = await findPosIntegrationById(integrationId)
  await notifyOpsAlert({
    kind: 'engineering_alert',
    severity: 'error',
    restaurantId: settings.snapshot.restaurantId,
    message: `Outbound webhook dead-lettered: ${integration?.name ?? integrationId}`,
    details: { eventId, integrationId, httpStatus: info.httpStatus, errorCode: info.errorCode },
  })
}

async function alertBreakerTripped(
  integrationId: string,
  settings: IntegrationSettings,
  streak: number
): Promise<void> {
  const integration = await findPosIntegrationById(integrationId)
  await notifyOpsAlert({
    kind: 'auto_pause_triggered',
    severity: 'error',
    restaurantId: settings.snapshot.restaurantId,
    message: `Outbound deliveries auto-paused after ${streak} consecutive failures: ${integration?.name ?? integrationId}`,
    details: { integrationId, streak },
  })
}
