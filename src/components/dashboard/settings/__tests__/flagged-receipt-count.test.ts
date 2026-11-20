// CAMP-016 r3 (F8): the pill reads a count, and refreshes when a flagged
// receipt is decided in FlaggedReceiptsPanel (a sibling of the Settings shell).
import { describe, it, expect, vi } from 'vitest'
import {
  decideFlaggedReceipt,
  fetchFlaggedReceiptCount,
  onFlaggedReceiptsChanged,
} from '../use-flagged-receipt-count'

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response

describe('flagged receipt count', () => {
  it('reads the count endpoint, never the receipt list', async () => {
    const fetcher = vi.fn(async () => ok({ count: 12 }))
    expect(await fetchFlaggedReceiptCount(fetcher)).toBe(12)
    expect(fetcher).toHaveBeenCalledWith('/api/dashboard/receipts/flagged/count', expect.anything())
  })

  it('is silent on failure: the pill just does not show', async () => {
    expect(await fetchFlaggedReceiptCount(vi.fn(async () => ({ ok: false }) as Response))).toBe(0)
    expect(await fetchFlaggedReceiptCount(vi.fn(async () => { throw new Error('offline') }))).toBe(0)
  })

  it('a successful decision signals a refresh; a failed one does not', async () => {
    const refresh = vi.fn()
    const off = onFlaggedReceiptsChanged(refresh)
    const fetcher = vi.fn(async () => ok({ status: 'ok' }))

    expect(await decideFlaggedReceipt('rc-1', 'approve', fetcher)).toBe(true)
    expect(fetcher).toHaveBeenCalledWith('/api/dashboard/receipts/flagged', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ receiptId: 'rc-1', action: 'approve' }),
    }))
    expect(refresh).toHaveBeenCalledTimes(1)

    expect(await decideFlaggedReceipt('rc-2', 'reject', vi.fn(async () => ({ ok: false }) as Response))).toBe(false)
    expect(refresh).toHaveBeenCalledTimes(1)

    off()
    await decideFlaggedReceipt('rc-3', 'approve', fetcher)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
