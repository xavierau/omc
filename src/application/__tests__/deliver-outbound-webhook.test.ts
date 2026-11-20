import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-delivery-repository', () => ({
  findDeliveryById: vi.fn(),
  saveDelivery: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-event-repository', () => ({
  findIntegrationEventById: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository', () => ({
  findIntegrationSettingsById: vi.fn(),
  readOutboundSecret: vi.fn(),
  updateOutboundBreakerState: vi.fn().mockResolvedValue(undefined),
  incrementOutboundFailureStreak: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/pos-integration-repository', () => ({
  findPosIntegrationById: vi.fn().mockResolvedValue({ id: 'int-1', name: 'Acme POS' }),
}))
vi.mock('@/application/build-outbound-payload', () => ({
  buildOutboundPayload: vi.fn(),
}))
vi.mock('@/application/notify-ops-alert', () => ({
  notifyOpsAlert: vi.fn().mockResolvedValue(undefined),
}))

import { findDeliveryById, saveDelivery } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { findIntegrationEventById } from '@/infrastructure/supabase/repositories/integration-event-repository'
import {
  findIntegrationSettingsById,
  incrementOutboundFailureStreak,
  readOutboundSecret,
  updateOutboundBreakerState,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { buildOutboundPayload } from '@/application/build-outbound-payload'
import { notifyOpsAlert } from '@/application/notify-ops-alert'
import { IntegrationDelivery, type IntegrationDeliveryProps } from '@/domain/entities/integration-delivery'
import { IntegrationSettings, type IntegrationSettingsProps } from '@/domain/entities/integration-settings'
import type { IntegrationEvent } from '@/domain/entities/integration-event'
import type { DeliveryResult, OutboundWebhookSender } from '@/domain/ports/outbound-webhook-sender'
import { signHmacSha256Hex } from '@/domain/services/webhook-signature'
import { deliverOutboundWebhook } from '../deliver-outbound-webhook'

function delivery(overrides: Partial<IntegrationDeliveryProps> = {}): IntegrationDelivery {
  return IntegrationDelivery.fromProps({
    id: 'del-1',
    integrationId: 'int-1',
    restaurantId: 'r-1',
    eventId: 'evt_1',
    status: 'queued',
    attempts: 0,
    lastHttpStatus: null,
    lastErrorCode: null,
    lastLatencyMs: null,
    responseExcerpt: null,
    nextRetryAt: null,
    enqueuedAt: '2026-09-10T00:00:00.000Z',
    deliveredAt: null,
    deadLetteredAt: null,
    retriedAt: null,
    ...overrides,
  })
}

function settings(overrides: Partial<IntegrationSettingsProps> = {}): IntegrationSettings {
  return IntegrationSettings.fromProps({
    integrationId: 'int-1',
    restaurantId: 'r-1',
    newJoinTemplateId: null,
    consentAttestationText: null,
    consentAttestationAckAt: null,
    consentAttestationAckBy: null,
    outboundUrl: 'https://partner.example.test/hook',
    outboundSecretLast4: 'abcd',
    outboundSecretUpdatedAt: null,
    outboundSecretUpdatedBy: null,
    outboundEvents: ['member.created'],
    outboundEnabled: true,
    outboundPiiAckAt: '2026-09-01T00:00:00.000Z',
    outboundPiiAckBy: 'u-1',
    outboundStatus: 'active',
    outboundFailureStreak: 0,
    outboundPausedAt: null,
    inboundRatePerMin: null,
    inboundBurst: null,
    inboundQueueCap: null,
    inboundSecretUpdatedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  })
}

const event: IntegrationEvent = {
  id: 'evt_1',
  restaurantId: 'r-1',
  memberId: 'm-1',
  type: 'member.created',
  changed: [],
  originIntegrationId: null,
  occurredAt: '2026-09-10T00:00:00.000Z',
  source: 'partner_api',
}

function fakeSender(script: DeliveryResult): OutboundWebhookSender {
  return { send: vi.fn().mockResolvedValue(script) }
}

const ORIGINAL_DISABLE = process.env.INT001_DISABLE_OUTBOUND
const NOW = new Date('2026-09-10T00:05:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.INT001_DISABLE_OUTBOUND
  vi.mocked(findDeliveryById).mockResolvedValue(delivery())
  vi.mocked(findIntegrationSettingsById).mockResolvedValue(settings())
  vi.mocked(findIntegrationEventById).mockResolvedValue(event)
  vi.mocked(buildOutboundPayload).mockResolvedValue({
    ok: true,
    payload: { id: 'evt_1' } as never,
    body: '{"id":"evt_1"}',
  })
  vi.mocked(readOutboundSecret).mockResolvedValue('super-secret-value')
  // I-8: default mirrors settings().snapshot.outboundFailureStreak (0) + 1
  // -- individual tests that configure a different starting streak
  // override this to the RPC's expected atomic return value directly.
  vi.mocked(incrementOutboundFailureStreak).mockResolvedValue(1)
})

afterEach(() => {
  if (ORIGINAL_DISABLE === undefined) delete process.env.INT001_DISABLE_OUTBOUND
  else process.env.INT001_DISABLE_OUTBOUND = ORIGINAL_DISABLE
})

describe('deliverOutboundWebhook -- pause / kill-switch (Attempt step 1)', () => {
  it('INT001_DISABLE_OUTBOUND=1 -> paused, no sender call, no Postgres/secret reads past the settings load', async () => {
    process.env.INT001_DISABLE_OUTBOUND = '1'
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 1, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result).toEqual({ kind: 'paused' })
    expect(sender.send).not.toHaveBeenCalled()
    expect(readOutboundSecret).not.toHaveBeenCalled()
    expect(saveDelivery).toHaveBeenCalledWith(expect.objectContaining({ snapshot: expect.objectContaining({ status: 'paused' }) }))
  })

  it('outbound_status != active -> paused, no sender call', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(settings({ outboundStatus: 'paused_auto' }))
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 1, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result).toEqual({ kind: 'paused' })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('a job whose row is already `retrying` (a prior BullMQ backoff) can still legally reach paused', async () => {
    vi.mocked(findDeliveryById).mockResolvedValue(delivery({ status: 'retrying', attempts: 1 }))
    process.env.INT001_DISABLE_OUTBOUND = '1'
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 1, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 2, { sender, clock: { now: () => NOW } })
    expect(result).toEqual({ kind: 'paused' })
  })
})

describe('deliverOutboundWebhook -- delivery/event/payload/secret preconditions', () => {
  it('delivery row not found -> permanent, no further reads', async () => {
    vi.mocked(findDeliveryById).mockResolvedValue(null)
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 1, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-missing', 1, { sender, clock: { now: () => NOW } })

    expect(result).toEqual({ kind: 'permanent' })
    expect(findIntegrationSettingsById).not.toHaveBeenCalled()
  })

  it('event row not found -> dead_lettered + a single Slack alert with event id/integration name/code only, no body', async () => {
    vi.mocked(findIntegrationEventById).mockResolvedValue(null)
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 1, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result).toEqual({ kind: 'permanent' })
    expect(sender.send).not.toHaveBeenCalled()
    expect(notifyOpsAlert).toHaveBeenCalledTimes(1)
    const alert = vi.mocked(notifyOpsAlert).mock.calls[0][0]
    expect(alert.message).toContain('Acme POS')
    expect(alert.details).toEqual({ eventId: 'evt_1', integrationId: 'int-1', httpStatus: null, errorCode: 'event_not_found' })
    expect(JSON.stringify(alert)).not.toMatch(/phone|\+852/i)
  })

  it('payload build failure -> dead_lettered + alert, sender never called', async () => {
    vi.mocked(buildOutboundPayload).mockResolvedValue({ ok: false, error: { title: 'member_not_found', details: 'm-1' } })
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 1, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result).toEqual({ kind: 'permanent' })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('secret missing -> dead_lettered + alert, sender never called', async () => {
    vi.mocked(readOutboundSecret).mockResolvedValue(null)
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 1, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result).toEqual({ kind: 'permanent' })
    expect(sender.send).not.toHaveBeenCalled()
  })
})

describe('deliverOutboundWebhook -- T-M4 sign at attempt time (secret rotation)', () => {
  it('reads the secret AFTER the pause/precondition checks, and signs with whatever is current at that moment', async () => {
    vi.mocked(readOutboundSecret).mockResolvedValue('rotated-secret')
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 1, responseExcerpt: null })

    await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    const sentRequest = vi.mocked(sender.send).mock.calls[0][0]
    const t = Math.floor(NOW.getTime() / 1000).toString()
    const expectedSignature = signHmacSha256Hex('rotated-secret', `${t}.${'{"id":"evt_1"}'}`)
    expect(sentRequest.headers['X-OMC-Signature']).toBe(`t=${t},v1=${expectedSignature}`)
  })

  it('a secret rotated BETWEEN a first delivery and a second (retry) attempt produces a DIFFERENT signature -- the delivery is never signed with a stale, enqueue-time secret', async () => {
    // First attempt (e.g. the original, exhausted job): secret A.
    vi.mocked(readOutboundSecret).mockResolvedValue('secret-a-before-rotation')
    const senderA = fakeSender({ ok: false, status: 503, latencyMs: 1, responseExcerpt: null })
    await deliverOutboundWebhook('del-1', 1, { sender: senderA, clock: { now: () => NOW } })
    const signatureA = vi.mocked(senderA.send).mock.calls[0][0].headers['X-OMC-Signature']

    // Owner rotates the secret. Second attempt (a manual retry, same
    // delivery row, no re-enqueue of a "captured" secret anywhere) reads
    // whatever is current NOW.
    vi.mocked(readOutboundSecret).mockResolvedValue('secret-b-after-rotation')
    const senderB = fakeSender({ ok: true, status: 200, latencyMs: 1, responseExcerpt: null })
    await deliverOutboundWebhook('del-1', 2, { sender: senderB, clock: { now: () => NOW } })
    const signatureB = vi.mocked(senderB.send).mock.calls[0][0].headers['X-OMC-Signature']

    expect(signatureA).not.toBe(signatureB)
    const t = Math.floor(NOW.getTime() / 1000).toString()
    const expectedB = `t=${t},v1=${signHmacSha256Hex('secret-b-after-rotation', `${t}.${'{"id":"evt_1"}'}`)}`
    expect(signatureB).toBe(expectedB)
  })
})

describe('deliverOutboundWebhook -- classification + breaker (T-M4, T-M8)', () => {
  it('2xx -> delivered, streak untouched when it was already 0', async () => {
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 42, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result).toEqual({ kind: 'delivered' })
    expect(updateOutboundBreakerState).not.toHaveBeenCalled()
  })

  it('2xx after a nonzero streak resets it to 0', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(settings({ outboundFailureStreak: 4 }))
    const sender = fakeSender({ ok: true, status: 200, latencyMs: 42, responseExcerpt: null })

    await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(updateOutboundBreakerState).toHaveBeenCalledWith({
      integrationId: 'int-1',
      restaurantId: 'r-1',
      outboundFailureStreak: 0,
    })
  })

  it('404 -> permanent -> dead_lettered in ONE attempt, and does NOT touch the failure streak (T-M4)', async () => {
    const sender = fakeSender({ ok: false, status: 404, latencyMs: 10, responseExcerpt: 'not found' })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result).toEqual({ kind: 'permanent' })
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(updateOutboundBreakerState).not.toHaveBeenCalled()
    expect(incrementOutboundFailureStreak).not.toHaveBeenCalled()
    expect(notifyOpsAlert).toHaveBeenCalledTimes(1)
  })

  // I-8: the increment is now atomic (migration 075's RPC) instead of a
  // client-computed `settings.snapshot.outboundFailureStreak + 1` -- these
  // tests configure the RPC's return value directly (what Postgres would
  // hand back for a caller's OWN increment, race-safe by construction)
  // rather than deriving it from the settings fixture.
  it('503 -> transient, calls the atomic increment RPC with the threshold, no breaker trip below threshold', async () => {
    vi.mocked(incrementOutboundFailureStreak).mockResolvedValue(3)
    const sender = fakeSender({ ok: false, status: 503, latencyMs: 10, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result.kind).toBe('transient')
    expect(incrementOutboundFailureStreak).toHaveBeenCalledWith('int-1', 10, NOW)
    expect(updateOutboundBreakerState).not.toHaveBeenCalled()
    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })

  it('429 with a parsed Retry-After -> transient result carries retryAfterSec', async () => {
    const sender = fakeSender({ ok: false, status: 429, latencyMs: 10, responseExcerpt: null, retryAfterSec: 120 })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result).toEqual({ kind: 'transient', retryAfterSec: 120 })
  })

  it('the Nth consecutive transient failure (atomic streak reaches 10) trips the breaker: alert fires, no separate updateOutboundBreakerState write (the RPC already flipped outbound_status atomically)', async () => {
    vi.mocked(incrementOutboundFailureStreak).mockResolvedValue(10)
    const sender = fakeSender({ ok: false, status: 503, latencyMs: 10, responseExcerpt: null })

    await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(updateOutboundBreakerState).not.toHaveBeenCalled()
    expect(notifyOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'auto_pause_triggered' })
    )
  })

  it('a streak below threshold after this failure does NOT trip the breaker', async () => {
    vi.mocked(incrementOutboundFailureStreak).mockResolvedValue(6)
    const sender = fakeSender({ ok: false, status: 503, latencyMs: 10, responseExcerpt: null })

    await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })

  it('a missing integration row (RPC returns null) does not crash the delivery attempt or fabricate an alert', async () => {
    vi.mocked(incrementOutboundFailureStreak).mockResolvedValue(null)
    const sender = fakeSender({ ok: false, status: 503, latencyMs: 10, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 1, { sender, clock: { now: () => NOW } })

    expect(result.kind).toBe('transient')
    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })
})

describe('deliverOutboundWebhook -- C-1: final-attempt transient exhaustion dead-letters', () => {
  it('transient result on the FINAL attempt (isFinalAttempt: true) dead-letters instead of retrying, alerts once, and returns permanent (no further BullMQ retries)', async () => {
    vi.mocked(incrementOutboundFailureStreak).mockResolvedValue(3)
    const sender = fakeSender({ ok: false, status: 503, latencyMs: 10, responseExcerpt: 'service unavailable' })

    const result = await deliverOutboundWebhook('del-1', 5, {
      sender,
      clock: { now: () => NOW },
      isFinalAttempt: true,
    })

    expect(result).toEqual({ kind: 'permanent' })
    expect(saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          status: 'dead_lettered',
          lastHttpStatus: 503,
          attempts: 1,
        }),
      })
    )
    // never left in `retrying` -- exactly one save transitions straight to dead_lettered
    expect(vi.mocked(saveDelivery).mock.calls.some((c) => (c[0] as { snapshot: { status: string } }).snapshot.status === 'retrying')).toBe(false)
    expect(notifyOpsAlert).toHaveBeenCalledTimes(1)
    expect(notifyOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('dead-lettered') })
    )
    // the genuine transient failure that happened still advances the breaker streak
    expect(incrementOutboundFailureStreak).toHaveBeenCalledWith('int-1', 10, NOW)
  })

  it('transient result on a NON-final attempt still retries as before (isFinalAttempt defaults to false)', async () => {
    vi.mocked(incrementOutboundFailureStreak).mockResolvedValue(3)
    const sender = fakeSender({ ok: false, status: 503, latencyMs: 10, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 3, { sender, clock: { now: () => NOW } })

    expect(result.kind).toBe('transient')
    expect(saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: expect.objectContaining({ status: 'retrying' }) })
    )
    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })

  it('a final-attempt transient failure that also crosses the breaker threshold still trips the breaker AND dead-letters (two alerts)', async () => {
    vi.mocked(incrementOutboundFailureStreak).mockResolvedValue(10)
    const sender = fakeSender({ ok: false, status: 503, latencyMs: 10, responseExcerpt: null })

    const result = await deliverOutboundWebhook('del-1', 5, {
      sender,
      clock: { now: () => NOW },
      isFinalAttempt: true,
    })

    expect(result).toEqual({ kind: 'permanent' })
    expect(notifyOpsAlert).toHaveBeenCalledTimes(2)
    expect(notifyOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'auto_pause_triggered' }))
    expect(notifyOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'engineering_alert' }))
  })
})
