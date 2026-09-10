import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/pos-transaction-repository')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/supabase/repositories/member-repository')

import {
  findUnlinkedTransactionsByPhone,
  claimUnlinkedTransaction,
} from '@/infrastructure/supabase/repositories/pos-transaction-repository'
import { emitEvent } from '@/application/emit-event'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { linkPosCustomer } from '../link-pos-customer'
import { buildPosTransaction } from '@/test-utils/builders'

describe('linkPosCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(claimUnlinkedTransaction).mockResolvedValue(true)
    vi.mocked(emitEvent).mockResolvedValue('event-1')
    vi.mocked(adjustMemberPoints).mockResolvedValue(80)
  })

  it('links unlinked transactions and awards points', async () => {
    const tx1 = buildPosTransaction({
      id: 'tx-1',
      memberId: null,
      type: 'sale',
      amount: 200,
      customerPhone: '+85291234567',
    })
    const tx2 = buildPosTransaction({
      id: 'tx-2',
      memberId: null,
      type: 'sale',
      amount: 100,
      customerPhone: '+85291234567',
    })
    vi.mocked(findUnlinkedTransactionsByPhone).mockResolvedValue([tx1, tx2])

    const result = await linkPosCustomer('rest-1', 'member-1', '+85291234567')

    expect(result.linkedCount).toBe(2)
    expect(result.totalPoints).toBe(30) // floor(200/10) + floor(100/10)
    expect(claimUnlinkedTransaction).toHaveBeenCalledTimes(2)
    expect(claimUnlinkedTransaction).toHaveBeenCalledWith('tx-1', 'member-1', 20)
    expect(claimUnlinkedTransaction).toHaveBeenCalledWith('tx-2', 'member-1', 10)
    expect(adjustMemberPoints).toHaveBeenCalledTimes(2)
    expect(adjustMemberPoints).toHaveBeenCalledWith('member-1', 20)
    expect(adjustMemberPoints).toHaveBeenCalledWith('member-1', 10)
  })

  it('returns zero when no unlinked transactions', async () => {
    vi.mocked(findUnlinkedTransactionsByPhone).mockResolvedValue([])

    const result = await linkPosCustomer('rest-1', 'member-1', '+85291234567')

    expect(result.linkedCount).toBe(0)
    expect(result.totalPoints).toBe(0)
    expect(claimUnlinkedTransaction).not.toHaveBeenCalled()
    expect(adjustMemberPoints).not.toHaveBeenCalled()
  })

  it('creates pos_customer_link events for each linked transaction', async () => {
    const tx = buildPosTransaction({
      id: 'tx-1',
      memberId: null,
      type: 'sale',
      amount: 150,
    })
    vi.mocked(findUnlinkedTransactionsByPhone).mockResolvedValue([tx])

    await linkPosCustomer('rest-1', 'member-1', '+85291234567')

    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      memberId: 'member-1',
      type: 'pos_customer_link',
      dataJson: expect.objectContaining({
        transaction_id: 'tx-1',
        amount: 150,
        points: 15,
        source: 'pos',
      }),
    })
  })

  it('continues processing when a single transaction fails', async () => {
    const tx1 = buildPosTransaction({ id: 'tx-1', memberId: null, type: 'sale', amount: 100 })
    const tx2 = buildPosTransaction({ id: 'tx-2', memberId: null, type: 'sale', amount: 200 })
    const tx3 = buildPosTransaction({ id: 'tx-3', memberId: null, type: 'sale', amount: 300 })
    vi.mocked(findUnlinkedTransactionsByPhone).mockResolvedValue([tx1, tx2, tx3])
    vi.mocked(adjustMemberPoints)
      .mockResolvedValueOnce(10)
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce(30)

    const result = await linkPosCustomer('rest-1', 'member-1', '+85291234567')

    expect(result.linkedCount).toBe(2)
    expect(result.totalPoints).toBe(40) // tx1(10) + tx3(30), tx2 failed
    expect(emitEvent).toHaveBeenCalledTimes(2)
  })

  it('skips already-claimed transactions', async () => {
    const tx1 = buildPosTransaction({ id: 'tx-1', memberId: null, type: 'sale', amount: 100 })
    const tx2 = buildPosTransaction({ id: 'tx-2', memberId: null, type: 'sale', amount: 200 })
    vi.mocked(findUnlinkedTransactionsByPhone).mockResolvedValue([tx1, tx2])
    vi.mocked(claimUnlinkedTransaction)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false) // tx-2 already claimed

    const result = await linkPosCustomer('rest-1', 'member-1', '+85291234567')

    expect(result.linkedCount).toBe(1)
    expect(result.totalPoints).toBe(10) // only tx-1
    expect(adjustMemberPoints).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledTimes(1)
  })

  it('handles refund transactions with negative points', async () => {
    const tx = buildPosTransaction({
      id: 'tx-1',
      memberId: null,
      type: 'refund',
      amount: 100,
    })
    vi.mocked(findUnlinkedTransactionsByPhone).mockResolvedValue([tx])

    const result = await linkPosCustomer('rest-1', 'member-1', '+85291234567')

    expect(result.totalPoints).toBe(-10)
    expect(claimUnlinkedTransaction).toHaveBeenCalledWith('tx-1', 'member-1', -10)
    // Per-transaction flow: adjustMemberPoints called with negative points
    expect(adjustMemberPoints).toHaveBeenCalledWith('member-1', -10)
  })
})
