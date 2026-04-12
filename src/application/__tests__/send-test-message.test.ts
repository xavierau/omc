import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendTestMessage } from '../send-test-message'

vi.mock('@/infrastructure/kapso/client', () => ({
  sendTextMessage: vi.fn(),
}))

import { sendTextMessage } from '@/infrastructure/kapso/client'

const mockSendTextMessage = vi.mocked(sendTextMessage)

describe('sendTestMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns sent true on success', async () => {
    mockSendTextMessage.mockResolvedValue(undefined)

    const result = await sendTestMessage('phone-id-1', '+85291234567')

    expect(result).toEqual({ sent: true })
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'phone-id-1',
      '+85291234567',
      'Hello from OhMyClient! Your WhatsApp number is connected.'
    )
  })

  it('returns error for phone number without + prefix', async () => {
    const result = await sendTestMessage('phone-id-1', '85291234567')

    expect(result).toEqual({
      sent: false,
      error: 'toNumber must start with + followed by digits',
    })
    expect(mockSendTextMessage).not.toHaveBeenCalled()
  })

  it('returns error when kapso client throws', async () => {
    mockSendTextMessage.mockRejectedValue(new Error('API down'))

    const result = await sendTestMessage('phone-id-1', '+85291234567')

    expect(result).toEqual({ sent: false, error: 'Failed to send test message' })
  })
})
