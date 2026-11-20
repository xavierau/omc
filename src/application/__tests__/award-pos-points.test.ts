import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/pos-transaction-repository')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/whatsapp/messaging')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/application/helpers/process-pos-transaction')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { createPosTransaction } from '@/infrastructure/supabase/repositories/pos-transaction-repository'
import { emitEvent } from '@/application/emit-event'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { findPosTransactionMember, notifyPosTransaction } from '@/application/helpers/process-pos-transaction'
import { awardPosPoints } from '../award-pos-points'
import { buildPosIntegration } from '@/test-utils/builders'
import type { PosWebhookEvent } from '@/domain/ports/pos-webhook'

const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn() })
const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })
const mockSupabase = { from: mockFrom }

const SALE_EVENT: PosWebhookEvent = {
  externalTransactionId: 'ext-tx-001',
  type: 'sale',
  amount: 150,
  currency: 'HKD',
  customerPhone: '+85291234567',
  timestamp: '2025-01-01T12:00:00Z',
  rawPayload: { transaction: { id: 'ext-tx-001' } },
}

const integration = buildPosIntegration()

describe('awardPosPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)
    vi.mocked(createPosTransaction).mockResolvedValue('pos-tx-1')
    vi.mocked(emitEvent).mockResolvedValue('event-1')
    vi.mocked(adjustMemberPoints).mockResolvedValue(115)
    vi.mocked(notifyPosTransaction).mockResolvedValue(undefined)
    vi.mocked(findPosTransactionMember).mockResolvedValue({
      id: 'member-1',
      pointsBalance: 100,
    })
  })

  it('awards points to existing member', async () => {
    const result = await awardPosPoints(SALE_EVENT, integration)

    expect(result.transactionId).toBe('pos-tx-1')
    expect(result.pointsAwarded).toBe(15) // floor(150 / 10)
    expect(result.memberId).toBe('member-1')
  })

  it('stores transaction with null member when no phone match', async () => {
    vi.mocked(findPosTransactionMember).mockResolvedValue(null)

    const result = await awardPosPoints(SALE_EVENT, integration)

    expect(result.transactionId).toBe('pos-tx-1')
    expect(result.pointsAwarded).toBe(0)
    expect(result.memberId).toBeNull()
    expect(createPosTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: null, pointsAwarded: 0 })
    )
  })

  it('returns null transactionId on duplicate', async () => {
    vi.mocked(createPosTransaction).mockResolvedValue(null)

    const result = await awardPosPoints(SALE_EVENT, integration)

    expect(result.transactionId).toBeNull()
    expect(result.pointsAwarded).toBe(0)
  })

  it('sends WhatsApp notification on success', async () => {
    await awardPosPoints(SALE_EVENT, integration)

    expect(notifyPosTransaction).toHaveBeenCalledWith(
      integration.restaurantId,
      '+85291234567',
      expect.stringContaining('15 points')
    )
  })

  it('calculates points as Math.floor(amount / POINTS_PER_DOLLAR)', async () => {
    const event = { ...SALE_EVENT, amount: 99 }
    const result = await awardPosPoints(event, integration)

    // floor(99 / 10) = 9
    expect(result.pointsAwarded).toBe(9)
  })

  it('stores transaction even without customerPhone', async () => {
    vi.mocked(findPosTransactionMember).mockResolvedValue(null)
    const event = { ...SALE_EVENT, customerPhone: null }

    const result = await awardPosPoints(event, integration)

    expect(result.memberId).toBeNull()
    expect(result.pointsAwarded).toBe(0)
    expect(createPosTransaction).toHaveBeenCalled()
  })

  it('completes successfully even when notification is a no-op', async () => {
    vi.mocked(notifyPosTransaction).mockResolvedValue(undefined)

    const result = await awardPosPoints(SALE_EVENT, integration)

    expect(result.transactionId).toBe('pos-tx-1')
    expect(result.pointsAwarded).toBe(15)
    expect(notifyPosTransaction).toHaveBeenCalled()
  })

  it('skips notification when customerPhone is missing', async () => {
    const eventNoPhone: PosWebhookEvent = { ...SALE_EVENT, customerPhone: null }
    vi.mocked(findPosTransactionMember).mockResolvedValue({
      id: 'member-1',
      pointsBalance: 100,
    })

    const result = await awardPosPoints(eventNoPhone, integration)

    expect(result.transactionId).toBe('pos-tx-1')
    expect(result.pointsAwarded).toBe(15)
    expect(notifyPosTransaction).not.toHaveBeenCalled()
  })
})
