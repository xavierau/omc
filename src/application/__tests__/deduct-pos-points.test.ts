import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/pos-transaction-repository')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/application/helpers/process-pos-transaction')

import { createPosTransaction } from '@/infrastructure/supabase/repositories/pos-transaction-repository'
import { emitEvent } from '@/application/emit-event'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { findPosTransactionMember, notifyPosTransaction } from '@/application/helpers/process-pos-transaction'
import { deductPosPoints } from '../deduct-pos-points'
import { buildPosIntegration } from '@/test-utils/builders'
import type { PosWebhookEvent } from '@/domain/ports/pos-webhook'

const REFUND_EVENT: PosWebhookEvent = {
  externalTransactionId: 'ext-refund-001',
  type: 'refund',
  amount: 100,
  currency: 'HKD',
  customerPhone: '+85291234567',
  timestamp: '2025-01-01T12:00:00Z',
  rawPayload: { transaction: { id: 'ext-refund-001' } },
}

const integration = buildPosIntegration()

describe('deductPosPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createPosTransaction).mockResolvedValue('pos-tx-2')
    vi.mocked(emitEvent).mockResolvedValue('event-1')
    vi.mocked(adjustMemberPoints).mockResolvedValue(90)
    vi.mocked(notifyPosTransaction).mockResolvedValue(undefined)
    vi.mocked(findPosTransactionMember).mockResolvedValue({
      id: 'member-1',
      pointsBalance: 100,
    })
  })

  it('deducts points from member', async () => {
    const result = await deductPosPoints(REFUND_EVENT, integration)

    expect(result.transactionId).toBe('pos-tx-2')
    expect(result.pointsDeducted).toBe(10) // floor(100 / 10)
    expect(result.memberId).toBe('member-1')
  })

  it('calls adjustMemberPoints with negative delta', async () => {
    vi.mocked(adjustMemberPoints).mockResolvedValue(0)

    await deductPosPoints(REFUND_EVENT, integration)

    expect(adjustMemberPoints).toHaveBeenCalledWith('member-1', -10)
  })

  it('sends refund notification', async () => {
    await deductPosPoints(REFUND_EVENT, integration)

    expect(notifyPosTransaction).toHaveBeenCalledWith(
      integration.restaurantId,
      '+85291234567',
      expect.stringContaining('Refund')
    )
  })

  it('returns null on duplicate', async () => {
    vi.mocked(createPosTransaction).mockResolvedValue(null)

    const result = await deductPosPoints(REFUND_EVENT, integration)

    expect(result.transactionId).toBeNull()
    expect(result.pointsDeducted).toBe(0)
  })

  it('stores refund transaction with type refund', async () => {
    await deductPosPoints(REFUND_EVENT, integration)

    expect(createPosTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'refund', pointsAwarded: -10 })
    )
  })

  it('completes successfully even when notification is a no-op', async () => {
    vi.mocked(notifyPosTransaction).mockResolvedValue(undefined)

    const result = await deductPosPoints(REFUND_EVENT, integration)

    expect(result.transactionId).toBe('pos-tx-2')
    expect(notifyPosTransaction).toHaveBeenCalled()
  })

  it('skips notification when customerPhone is missing', async () => {
    const eventNoPhone: PosWebhookEvent = { ...REFUND_EVENT, customerPhone: null }

    const result = await deductPosPoints(eventNoPhone, integration)

    expect(result.transactionId).toBe('pos-tx-2')
    expect(notifyPosTransaction).not.toHaveBeenCalled()
  })
})
