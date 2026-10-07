import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/campaign-counters', () => ({
  retractCampaignSent: vi.fn(),
}))

import { retractCampaignSent } from '@/infrastructure/supabase/repositories/campaign-counters'
import { reconcileCampaignSendFailure } from '../reconcile-campaign-send-failure'
import {
  WhatsAppMessage,
  type WhatsAppMessageProps,
} from '@/domain/entities/whatsapp-message'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

function message(overrides: Partial<WhatsAppMessageProps> = {}): WhatsAppMessage {
  return WhatsAppMessage.fromProps({
    id: 'local-1',
    restaurantId: 'rest-1',
    memberId: 'mem-1',
    campaignId: 'camp-1',
    phoneE164: '85290000001',
    direction: 'outbound',
    category: 'marketing',
    messageType: 'template',
    templateId: 'tpl-1',
    templateName: 'promo',
    contentPreview: null,
    kapsoMessageId: 'wamid.AAA',
    status: 'sent',
    errorCode: null,
    errorTitle: null,
    errorDetails: null,
    queuedAt: '2026-08-27T13:58:00.000Z',
    sentAt: '2026-08-27T13:58:01.000Z',
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    ...overrides,
  })
}

const failed131042 = (overrides: Partial<WhatsAppMessageProps> = {}) =>
  message({
    status: 'failed',
    errorCode: '131042',
    errorTitle: 'Business eligibility payment issue',
    failedAt: '2026-08-27T13:58:05.000Z',
    ...overrides,
  })

describe('reconcileCampaignSendFailure (#131)', () => {
  let logs: Array<[string, string, unknown]>
  const log: LogFn = (level, event, data) => {
    logs.push([level, event, data])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
    vi.mocked(retractCampaignSent).mockResolvedValue({
      status: 'failed',
      chargeableSentCount: 0,
      nonChargeableSentCount: 0,
    })
  })

  it('retracts a campaign template body that flipped sent → failed with an error code', async () => {
    await reconcileCampaignSendFailure({ before: message(), after: failed131042(), log })

    expect(retractCampaignSent).toHaveBeenCalledTimes(1)
    expect(retractCampaignSent).toHaveBeenCalledWith({
      campaignId: 'camp-1',
      restaurantId: 'rest-1',
      failureReason: expect.stringContaining('131042'),
    })
    const entry = logs.find((l) => l[1] === 'campaign.send_retracted')
    expect(entry?.[0]).toBe('info')
    expect(entry?.[2]).toMatchObject({ campaignId: 'camp-1', status: 'failed' })
  })

  it('retracts an inline text body too (no-template campaigns are counted the same way)', async () => {
    await reconcileCampaignSendFailure({
      before: message({ messageType: 'text', category: 'service' }),
      after: failed131042({ messageType: 'text', category: 'service', errorCode: '131047' }),
      log,
    })

    expect(retractCampaignSent).toHaveBeenCalledTimes(1)
  })

  it('never retracts for the coupon-QR image — it was never counted', async () => {
    await reconcileCampaignSendFailure({
      before: message({ messageType: 'image', category: 'service' }),
      after: failed131042({ messageType: 'image', category: 'service', errorCode: '131047' }),
      log,
    })

    expect(retractCampaignSent).not.toHaveBeenCalled()
  })

  it('no-ops without a campaignId (conversational sends)', async () => {
    await reconcileCampaignSendFailure({
      before: message({ campaignId: null }),
      after: failed131042({ campaignId: null }),
      log,
    })

    expect(retractCampaignSent).not.toHaveBeenCalled()
  })

  it('no-ops when the row was already failed before this webhook (second failed event)', async () => {
    await reconcileCampaignSendFailure({
      before: failed131042(),
      after: failed131042(),
      log,
    })

    expect(retractCampaignSent).not.toHaveBeenCalled()
  })

  it('no-ops when the lattice rejected the transition (post-image not failed)', async () => {
    await reconcileCampaignSendFailure({
      before: message({ status: 'read' }),
      after: message({ status: 'read' }),
      log,
    })

    expect(retractCampaignSent).not.toHaveBeenCalled()
  })

  it('no-ops when a coerced unknown status has no error code', async () => {
    await reconcileCampaignSendFailure({
      before: message(),
      after: failed131042({ errorCode: null, errorTitle: null }),
      log,
    })

    expect(retractCampaignSent).not.toHaveBeenCalled()
  })

  it('logs a warning when the RPC matched no row (wrong tenant / deleted campaign)', async () => {
    vi.mocked(retractCampaignSent).mockResolvedValue(null)

    await reconcileCampaignSendFailure({ before: message(), after: failed131042(), log })

    const entry = logs.find((l) => l[1] === 'campaign.retract_no_match')
    expect(entry?.[0]).toBe('warn')
  })

  it('swallows a thrown retract and logs at error with the campaignId (never blocks the webhook)', async () => {
    vi.mocked(retractCampaignSent).mockRejectedValue(new Error('db down'))

    await expect(
      reconcileCampaignSendFailure({ before: message(), after: failed131042(), log })
    ).resolves.toBeUndefined()

    const entry = logs.find((l) => l[1] === 'campaign.retract_failed')
    expect(entry?.[0]).toBe('error')
    expect(entry?.[2]).toMatchObject({ campaignId: 'camp-1', error: 'db down' })
  })
})
