import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/pos-integration-repository')
vi.mock('@/infrastructure/pos/webhook')
vi.mock('../award-pos-points')
vi.mock('../deduct-pos-points')

import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { parsePosWebhook, verifyPosSignature } from '@/infrastructure/pos/webhook'
import { awardPosPoints } from '../award-pos-points'
import { deductPosPoints } from '../deduct-pos-points'
import { processPosWebhook } from '../process-pos-webhook'
import { buildPosIntegration } from '@/test-utils/builders'

const integration = buildPosIntegration()
const rawBody = JSON.stringify({ event_type: 'payment_completed', transaction: { id: 'tx-1', total: 100 } })

describe('processPosWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findPosIntegrationById).mockResolvedValue(integration)
    vi.mocked(verifyPosSignature).mockReturnValue(true)
    vi.mocked(parsePosWebhook).mockReturnValue({
      externalTransactionId: 'tx-1',
      type: 'sale',
      amount: 100,
      currency: 'HKD',
      customerPhone: '+85291234567',
      timestamp: '2025-01-01T12:00:00Z',
      rawPayload: {},
    })
    vi.mocked(awardPosPoints).mockResolvedValue({
      transactionId: 'pos-tx-1',
      pointsAwarded: 10,
      memberId: 'member-1',
    })
    vi.mocked(deductPosPoints).mockResolvedValue({
      transactionId: 'pos-tx-2',
      pointsDeducted: 10,
      memberId: 'member-1',
    })
  })

  it('returns ignored when integration not found', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(null)

    const result = await processPosWebhook('unknown-id', rawBody, null)

    expect(result).toEqual({ status: 'ignored', message: 'Webhook ignored' })
  })

  it('returns ignored when integration inactive', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(
      buildPosIntegration({ status: 'inactive' })
    )

    const result = await processPosWebhook('pos-integration-1', rawBody, null)

    expect(result).toEqual({ status: 'ignored', message: 'Webhook ignored' })
  })

  it('returns ignored when integration has no webhookSecret configured', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(
      buildPosIntegration({ webhookSecret: null })
    )

    const result = await processPosWebhook('pos-integration-1', rawBody, 'sig')

    expect(result).toEqual({ status: 'ignored', message: 'Webhook ignored' })
  })

  it('returns error when signature is missing', async () => {
    const result = await processPosWebhook('pos-integration-1', rawBody, null)

    expect(result).toEqual({ status: 'error', message: 'Missing webhook signature' })
  })

  it('returns error when signature invalid', async () => {
    vi.mocked(verifyPosSignature).mockReturnValue(false)

    const result = await processPosWebhook(
      'pos-integration-1', rawBody, 'bad-signature'
    )

    expect(result.status).toBe('error')
  })

  it('returns ignored when payload cannot be parsed', async () => {
    vi.mocked(parsePosWebhook).mockReturnValue(null)

    const result = await processPosWebhook('pos-integration-1', rawBody, 'sig')

    expect(result.status).toBe('ignored')
  })

  it('returns ok for valid sale and calls awardPosPoints', async () => {
    const result = await processPosWebhook('pos-integration-1', rawBody, 'sig')

    expect(result.status).toBe('ok')
    expect(awardPosPoints).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sale' }),
      integration
    )
  })

  it('returns ok for valid refund and calls deductPosPoints', async () => {
    vi.mocked(parsePosWebhook).mockReturnValue({
      externalTransactionId: 'tx-1',
      type: 'refund',
      amount: 100,
      currency: 'HKD',
      customerPhone: '+85291234567',
      timestamp: '2025-01-01T12:00:00Z',
      rawPayload: {},
    })

    const result = await processPosWebhook('pos-integration-1', rawBody, 'sig')

    expect(result.status).toBe('ok')
    expect(deductPosPoints).toHaveBeenCalled()
  })

  it('returns duplicate when transaction already exists', async () => {
    vi.mocked(awardPosPoints).mockResolvedValue({
      transactionId: null,
      pointsAwarded: 0,
      memberId: null,
    })

    const result = await processPosWebhook('pos-integration-1', rawBody, 'sig')

    expect(result.status).toBe('duplicate')
  })
})
