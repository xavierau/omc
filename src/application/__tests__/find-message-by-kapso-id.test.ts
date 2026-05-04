import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-repository', () => ({
  findByKapsoMessageId: vi.fn(),
}))

import { findByKapsoMessageId } from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import { findMessageByKapsoIdWithRetry } from '../find-message-by-kapso-id'
import type { WhatsAppMessage } from '@/domain/entities/whatsapp-message'

// Minimal stand-in object — the helper returns whatever the repo gives back,
// so we don't need a real WhatsAppMessage entity for this test.
const fakeMessage = { id: 'wm-1' } as unknown as WhatsAppMessage

// FIX 6 (review round 1): asserts the addendum §4.2 retry contract for the
// race where the BSP webhook arrives before recordOutboundSend has UPDATEd
// the row with kapso_message_id.

describe('findMessageByKapsoIdWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the first hit without sleeping', async () => {
    vi.mocked(findByKapsoMessageId).mockResolvedValueOnce(fakeMessage)

    const result = await findMessageByKapsoIdWithRetry('wamid.X')

    expect(result).toBe(fakeMessage)
    expect(findByKapsoMessageId).toHaveBeenCalledTimes(1)
    expect(findByKapsoMessageId).toHaveBeenCalledWith('wamid.X')
  })

  it('retries exactly once after 250ms when the first call misses', async () => {
    vi.mocked(findByKapsoMessageId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fakeMessage)

    const promise = findMessageByKapsoIdWithRetry('wamid.Y')

    // First lookup runs, then the helper schedules a 250ms delay.
    // Drain microtasks so the first promise resolves and the setTimeout is queued.
    await Promise.resolve()
    expect(findByKapsoMessageId).toHaveBeenCalledTimes(1)

    // Advance fake time exactly 250ms — this fires the delay and the second lookup.
    await vi.advanceTimersByTimeAsync(250)

    const result = await promise
    expect(result).toBe(fakeMessage)
    expect(findByKapsoMessageId).toHaveBeenCalledTimes(2)
  })

  it('returns null when both lookups miss (idempotency claim path)', async () => {
    vi.mocked(findByKapsoMessageId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const promise = findMessageByKapsoIdWithRetry('wamid.Z')
    await vi.advanceTimersByTimeAsync(250)

    const result = await promise
    expect(result).toBeNull()
    expect(findByKapsoMessageId).toHaveBeenCalledTimes(2)
  })
})
