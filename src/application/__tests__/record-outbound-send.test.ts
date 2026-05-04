import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-repository', () => ({
  insertQueuedMessage: vi.fn(),
  attachKapsoMessageId: vi.fn(),
  markFailedNoBspId: vi.fn(),
}))

import {
  insertQueuedMessage,
  attachKapsoMessageId,
  markFailedNoBspId,
} from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import { recordOutboundSend } from '../record-outbound-send'
import { okResult, failResult } from '@/test-utils/send-result'

const BASE_ARGS = {
  restaurantId: 'rest-1',
  memberId: 'mem-1',
  campaignId: 'camp-1',
  phoneE164: '85291234567',
  category: 'marketing' as const,
  messageType: 'template' as const,
  contentPreview: 'Hi Alice',
  template: { id: 'tpl-1', name: 'promo_v1' },
  trackingEnabled: true,
}

describe('recordOutboundSend (trackingEnabled=true)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('insert -> send -> attach kapso id on success', async () => {
    const sendResult = okResult('wamid.123')
    const send = vi.fn().mockResolvedValue(sendResult)

    const result = await recordOutboundSend({ ...BASE_ARGS, send })

    expect(insertQueuedMessage).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
    // Insert must precede send
    expect(vi.mocked(insertQueuedMessage).mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0]
    )
    expect(attachKapsoMessageId).toHaveBeenCalledOnce()
    expect(markFailedNoBspId).not.toHaveBeenCalled()
    expect(result).toEqual(sendResult)
  })

  it('insert -> send throws -> markFailedNoBspId', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await recordOutboundSend({ ...BASE_ARGS, send })

    expect(insertQueuedMessage).toHaveBeenCalledOnce()
    expect(markFailedNoBspId).toHaveBeenCalledOnce()
    expect(attachKapsoMessageId).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('send_threw')
    expect(result.error?.details).toBe('network down')
  })

  it('insert -> send returns ok=false -> markFailedNoBspId', async () => {
    const sendResult = failResult('kapso_no_message_id')
    const send = vi.fn().mockResolvedValue(sendResult)

    const result = await recordOutboundSend({ ...BASE_ARGS, send })

    expect(insertQueuedMessage).toHaveBeenCalledOnce()
    expect(markFailedNoBspId).toHaveBeenCalledOnce()
    expect(attachKapsoMessageId).not.toHaveBeenCalled()
    expect(result).toEqual(sendResult)
  })
})

describe('recordOutboundSend (trackingEnabled=false)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('short-circuits to send() with no DB writes', async () => {
    const sendResult = okResult('wamid.untracked')
    const send = vi.fn().mockResolvedValue(sendResult)

    const result = await recordOutboundSend({
      ...BASE_ARGS,
      trackingEnabled: false,
      send,
    })

    expect(send).toHaveBeenCalledOnce()
    expect(insertQueuedMessage).not.toHaveBeenCalled()
    expect(attachKapsoMessageId).not.toHaveBeenCalled()
    expect(markFailedNoBspId).not.toHaveBeenCalled()
    expect(result).toEqual(sendResult)
  })

  it('still propagates thrown errors from send()', async () => {
    const send = vi.fn().mockRejectedValue(new Error('flag-off boom'))

    await expect(
      recordOutboundSend({
        ...BASE_ARGS,
        trackingEnabled: false,
        send,
      })
    ).rejects.toThrow('flag-off boom')
    expect(insertQueuedMessage).not.toHaveBeenCalled()
  })
})
