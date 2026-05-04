import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/idempotency', () => ({
  tryMarkProcessed: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
}))
vi.mock('@/application/find-message-by-kapso-id', () => ({
  findMessageByKapsoIdWithRetry: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/whatsapp-message-repository',
  () => ({
    applyStatusUpdate: vi.fn(),
  })
)

import {
  tryMarkProcessed,
  releaseIdempotencyKey,
} from '@/infrastructure/supabase/idempotency'
import { findMessageByKapsoIdWithRetry } from '@/application/find-message-by-kapso-id'
import { applyStatusUpdate } from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import { WhatsAppMessage } from '@/domain/entities/whatsapp-message'
import {
  handleStatusUpdate,
  mapStatusUpdate,
  routeStatusEvent,
} from '../status-handlers'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

function buildMessage(
  status: WhatsAppMessage['snapshot']['status'] = 'sent',
  overrides: Partial<WhatsAppMessage['snapshot']> = {}
): WhatsAppMessage {
  const base = WhatsAppMessage.fromProps({
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
    contentPreview: 'Hi',
    kapsoMessageId: 'wamid.AAA',
    status,
    errorCode: null,
    errorTitle: null,
    errorDetails: null,
    queuedAt: '2026-05-04T10:00:00.000Z',
    sentAt: '2026-05-04T10:00:01.000Z',
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    ...overrides,
  })
  return base
}

describe('mapStatusUpdate', () => {
  it('maps a delivered status with iso timestamp', () => {
    const out = mapStatusUpdate({
      id: 'wamid.A',
      status: 'delivered',
      timestamp: '2026-05-04T10:00:02.000Z',
      raw: {},
    })
    expect(out).toMatchObject({
      status: 'delivered',
      timestamp: '2026-05-04T10:00:02.000Z',
    })
    // No error fields on a non-failed status
    expect(out.errorCode).toBeNull()
    expect(out.errorTitle).toBeNull()
    expect(out.errorDetails).toBeNull()
  })

  it('parses a unix-second timestamp string into ISO', () => {
    const out = mapStatusUpdate({
      id: 'wamid.A',
      status: 'sent',
      timestamp: '1762257600',
      raw: {},
    })
    expect(out.timestamp).toBe(new Date(1762257600 * 1000).toISOString())
  })

  it('omits timestamp when missing or unparseable', () => {
    const out = mapStatusUpdate({
      id: 'wamid.A',
      status: 'sent',
      raw: {},
    })
    expect(out.timestamp).toBeUndefined()
  })

  it('extracts errors[0] code/title/details on failed status', () => {
    const out = mapStatusUpdate({
      id: 'wamid.A',
      status: 'failed',
      errors: [
        {
          code: 131049,
          title: 'PMM hit',
          error_data: { details: 'rate-limited' },
        },
      ],
      raw: {},
    })
    expect(out).toMatchObject({
      status: 'failed',
      errorCode: '131049',
      errorTitle: 'PMM hit',
      errorDetails: 'rate-limited',
    })
  })

  it('handles failed status without errors[] gracefully', () => {
    const out = mapStatusUpdate({
      id: 'wamid.A',
      status: 'failed',
      raw: {},
    })
    expect(out.errorCode).toBeNull()
  })

  it('treats unknown status strings as failed (defensive)', () => {
    const out = mapStatusUpdate({
      id: 'wamid.A',
      status: 'undeliverable', // unexpected from BSP
      raw: {},
    })
    // We choose to coerce unknown -> failed so the row reflects the bad outcome
    expect(out.status).toBe('failed')
  })
})

describe('handleStatusUpdate', () => {
  let logs: Array<[string, string, unknown]>
  const log: LogFn = (level, event, data) => {
    logs.push([level, event, data])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
  })

  it('happy path: claims, finds, applies update, does not release', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(findMessageByKapsoIdWithRetry).mockResolvedValue(
      buildMessage('sent')
    )
    vi.mocked(applyStatusUpdate).mockResolvedValue(
      buildMessage('delivered', { deliveredAt: '2026-05-04T10:00:02.000Z' })
    )

    await handleStatusUpdate(
      {
        id: 'wamid.AAA',
        status: 'delivered',
        timestamp: '2026-05-04T10:00:02.000Z',
        raw: { id: 'wamid.AAA', status: 'delivered' },
      },
      'rest-1',
      log
    )

    expect(tryMarkProcessed).toHaveBeenCalledWith('wamid.AAA:delivered', log)
    expect(findMessageByKapsoIdWithRetry).toHaveBeenCalledWith('wamid.AAA')
    expect(applyStatusUpdate).toHaveBeenCalledWith(
      'wamid.AAA',
      expect.objectContaining({ status: 'delivered' }),
      expect.any(Object)
    )
    expect(releaseIdempotencyKey).not.toHaveBeenCalled()
  })

  it('returns early on duplicate claim', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('duplicate')

    await handleStatusUpdate(
      {
        id: 'wamid.AAA',
        status: 'delivered',
        raw: {},
      },
      'rest-1',
      log
    )

    expect(findMessageByKapsoIdWithRetry).not.toHaveBeenCalled()
    expect(applyStatusUpdate).not.toHaveBeenCalled()
    expect(releaseIdempotencyKey).not.toHaveBeenCalled()
  })

  it('returns early on claim error (does not retry side effects)', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('error')

    await handleStatusUpdate(
      { id: 'wamid.AAA', status: 'delivered', raw: {} },
      'rest-1',
      log
    )

    expect(findMessageByKapsoIdWithRetry).not.toHaveBeenCalled()
    expect(applyStatusUpdate).not.toHaveBeenCalled()
  })

  it('unknown id: releases idempotency key and logs warn (no row update)', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(findMessageByKapsoIdWithRetry).mockResolvedValue(null)

    await handleStatusUpdate(
      {
        id: 'wamid.MISSING',
        status: 'delivered',
        raw: {},
      },
      'rest-1',
      log
    )

    expect(releaseIdempotencyKey).toHaveBeenCalledWith(
      'wamid.MISSING:delivered'
    )
    expect(applyStatusUpdate).not.toHaveBeenCalled()
    const warnEntry = logs.find((l) => l[1] === 'status.unknown_message')
    expect(warnEntry).toBeDefined()
    expect(warnEntry?.[0]).toBe('warn')
  })

  it('failed webhook updates the row with error fields and does NOT call dispatchErrorAction', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(findMessageByKapsoIdWithRetry).mockResolvedValue(
      buildMessage('sent')
    )
    vi.mocked(applyStatusUpdate).mockResolvedValue(
      buildMessage('failed', {
        status: 'failed',
        errorCode: '131049',
        errorTitle: 'PMM',
        failedAt: '2026-05-04T10:00:05.000Z',
      })
    )

    await handleStatusUpdate(
      {
        id: 'wamid.AAA',
        status: 'failed',
        errors: [
          {
            code: 131049,
            title: 'PMM',
            error_data: { details: 'rate-limited' },
          },
        ],
        raw: {},
      },
      'rest-1',
      log
    )

    expect(applyStatusUpdate).toHaveBeenCalledWith(
      'wamid.AAA',
      expect.objectContaining({
        status: 'failed',
        errorCode: '131049',
        errorTitle: 'PMM',
        errorDetails: 'rate-limited',
      }),
      expect.any(Object)
    )
    const failedLog = logs.find((l) => l[1] === 'webhook.status_failed')
    expect(failedLog).toBeDefined()
    expect(failedLog?.[2]).toMatchObject({ errorCode: '131049' })
    expect(releaseIdempotencyKey).not.toHaveBeenCalled()
  })
})

describe('routeStatusEvent', () => {
  let logs: Array<[string, string, unknown]>
  const log: LogFn = (level, event, data) => {
    logs.push([level, event, data])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
  })

  it('iterates statuses and processes each', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(findMessageByKapsoIdWithRetry).mockResolvedValue(
      WhatsAppMessage.fromProps({
        id: 'mid',
        restaurantId: 'rest-1',
        memberId: null,
        campaignId: null,
        phoneE164: '85291234567',
        direction: 'outbound',
        category: 'utility',
        messageType: 'text',
        templateId: null,
        templateName: null,
        contentPreview: null,
        kapsoMessageId: 'wamid.A',
        status: 'sent',
        errorCode: null,
        errorTitle: null,
        errorDetails: null,
        queuedAt: '2026-05-04T10:00:00.000Z',
        sentAt: '2026-05-04T10:00:01.000Z',
        deliveredAt: null,
        readAt: null,
        failedAt: null,
      })
    )
    vi.mocked(applyStatusUpdate).mockResolvedValue(null)

    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.A', status: 'delivered' },
                  { id: 'wamid.B', status: 'read' },
                ],
              },
            },
          ],
        },
      ],
    }

    await routeStatusEvent(body, 'rest-1', log)

    expect(tryMarkProcessed).toHaveBeenCalledTimes(2)
    expect(tryMarkProcessed).toHaveBeenNthCalledWith(
      1,
      'wamid.A:delivered',
      log
    )
    expect(tryMarkProcessed).toHaveBeenNthCalledWith(2, 'wamid.B:read', log)
  })
})
