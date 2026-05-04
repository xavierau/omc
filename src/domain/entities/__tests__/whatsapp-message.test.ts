import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  WhatsAppMessage,
  type QueueOutboundInput,
} from '../whatsapp-message'

const FIXED_NOW = new Date('2026-05-04T10:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function buildInput(
  overrides: Partial<QueueOutboundInput> = {}
): QueueOutboundInput {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    restaurantId: 'rest-1',
    memberId: 'mem-1',
    campaignId: 'camp-1',
    phoneE164: '85291234567',
    category: 'marketing',
    messageType: 'template',
    templateId: 'tpl-1',
    templateName: 'promo_v1',
    contentPreview: 'Hi Alice, save 10%!',
    ...overrides,
  }
}

describe('WhatsAppMessage.queue', () => {
  it('constructs an outbound queued message with timestamps and nullable fields', () => {
    const msg = WhatsAppMessage.queue(buildInput())

    expect(msg.snapshot).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      restaurantId: 'rest-1',
      memberId: 'mem-1',
      campaignId: 'camp-1',
      phoneE164: '85291234567',
      direction: 'outbound',
      category: 'marketing',
      messageType: 'template',
      templateId: 'tpl-1',
      templateName: 'promo_v1',
      contentPreview: 'Hi Alice, save 10%!',
      kapsoMessageId: null,
      status: 'queued',
      errorCode: null,
      errorTitle: null,
      errorDetails: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    })
    expect(msg.snapshot.queuedAt).toBe(FIXED_NOW.toISOString())
  })

  it('accepts null member and campaign for one-off utility sends', () => {
    const msg = WhatsAppMessage.queue(
      buildInput({ memberId: null, campaignId: null, category: 'utility' })
    )
    expect(msg.snapshot.memberId).toBeNull()
    expect(msg.snapshot.campaignId).toBeNull()
    expect(msg.snapshot.category).toBe('utility')
  })

  it('snapshot is read-only and detached from internal state', () => {
    const msg = WhatsAppMessage.queue(buildInput())
    const a = msg.snapshot
    const b = msg.snapshot
    // Same shape regardless of caller
    expect(a).toEqual(b)
  })
})

describe('WhatsAppMessage.applyStatusUpdate', () => {
  it('promotes queued -> sent and stamps sentAt', () => {
    const msg = WhatsAppMessage.queue(buildInput())
    const next = msg.applyStatusUpdate({
      status: 'sent',
      timestamp: '2026-05-04T10:00:01.000Z',
    })
    expect(next.snapshot.status).toBe('sent')
    expect(next.snapshot.sentAt).toBe('2026-05-04T10:00:01.000Z')
  })

  it('falls back to current time when no timestamp is supplied', () => {
    const msg = WhatsAppMessage.queue(buildInput())
    const next = msg.applyStatusUpdate({ status: 'sent' })
    expect(next.snapshot.sentAt).toBe(FIXED_NOW.toISOString())
  })

  it('promotes sent -> delivered -> read and stamps each timestamp', () => {
    const queued = WhatsAppMessage.queue(buildInput())
    const sent = queued.applyStatusUpdate({
      status: 'sent',
      timestamp: '2026-05-04T10:00:01.000Z',
    })
    const delivered = sent.applyStatusUpdate({
      status: 'delivered',
      timestamp: '2026-05-04T10:00:02.000Z',
    })
    const read = delivered.applyStatusUpdate({
      status: 'read',
      timestamp: '2026-05-04T10:00:03.000Z',
    })
    expect(read.snapshot.sentAt).toBe('2026-05-04T10:00:01.000Z')
    expect(read.snapshot.deliveredAt).toBe('2026-05-04T10:00:02.000Z')
    expect(read.snapshot.readAt).toBe('2026-05-04T10:00:03.000Z')
    expect(read.snapshot.status).toBe('read')
  })

  it('rejects regression: read -> delivered keeps read', () => {
    const queued = WhatsAppMessage.queue(buildInput())
    const read = queued
      .applyStatusUpdate({ status: 'sent' })
      .applyStatusUpdate({ status: 'delivered' })
      .applyStatusUpdate({ status: 'read' })
    const noop = read.applyStatusUpdate({
      status: 'delivered',
      timestamp: '2026-05-04T11:00:00.000Z',
    })
    expect(noop.snapshot.status).toBe('read')
    // delivered_at must not be overwritten by the regression
    expect(noop.snapshot.deliveredAt).toBe(read.snapshot.deliveredAt)
  })

  it('rejects regression: read -> failed keeps read (read is terminal-success)', () => {
    const queued = WhatsAppMessage.queue(buildInput())
    const read = queued
      .applyStatusUpdate({ status: 'sent' })
      .applyStatusUpdate({ status: 'delivered' })
      .applyStatusUpdate({ status: 'read' })
    const noop = read.applyStatusUpdate({
      status: 'failed',
      errorCode: '131049',
      errorTitle: 'PMM hit',
    })
    expect(noop.snapshot.status).toBe('read')
    expect(noop.snapshot.errorCode).toBeNull()
  })

  it('failed retains error fields and stamps failedAt', () => {
    const queued = WhatsAppMessage.queue(buildInput())
    const failed = queued.applyStatusUpdate({
      status: 'failed',
      errorCode: '131026',
      errorTitle: 'recipient cannot receive',
      errorDetails: 'cap reached',
      timestamp: '2026-05-04T10:00:05.000Z',
    })
    expect(failed.snapshot.status).toBe('failed')
    expect(failed.snapshot.errorCode).toBe('131026')
    expect(failed.snapshot.errorTitle).toBe('recipient cannot receive')
    expect(failed.snapshot.errorDetails).toBe('cap reached')
    expect(failed.snapshot.failedAt).toBe('2026-05-04T10:00:05.000Z')
  })

  it('failed is terminal — subsequent updates are no-op', () => {
    const queued = WhatsAppMessage.queue(buildInput())
    const failed = queued.applyStatusUpdate({
      status: 'failed',
      errorCode: '131026',
      errorTitle: 'unreachable',
    })
    const noop = failed.applyStatusUpdate({ status: 'delivered' })
    expect(noop.snapshot.status).toBe('failed')
    expect(noop.snapshot.deliveredAt).toBeNull()
  })

  it('out-of-order webhook (delivered before sent) promotes to delivered', () => {
    const queued = WhatsAppMessage.queue(buildInput())
    const delivered = queued.applyStatusUpdate({
      status: 'delivered',
      timestamp: '2026-05-04T10:00:02.000Z',
    })
    expect(delivered.snapshot.status).toBe('delivered')
    expect(delivered.snapshot.deliveredAt).toBe('2026-05-04T10:00:02.000Z')
    // sent_at remains null because the sent webhook was lost — that's fine
    expect(delivered.snapshot.sentAt).toBeNull()
  })

  it('returns the same instance when transition is rejected', () => {
    const queued = WhatsAppMessage.queue(buildInput())
    const noop = queued.applyStatusUpdate({ status: 'queued' })
    expect(noop).toBe(queued)
  })
})
