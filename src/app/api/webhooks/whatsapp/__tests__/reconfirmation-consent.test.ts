import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/application/confirm-reconfirmation-consent', () => ({
  confirmReconfirmationConsent: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/conversation-window-repository',
  () => ({ isWindowOpen: vi.fn() })
)

import { handleReconfirmationConsent } from '../reconfirmation-consent'
import { confirmReconfirmationConsent } from '@/application/confirm-reconfirmation-consent'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'

const CTX = {
  phoneNumberId: 'pn-1',
  phone: '+85291111111',
  restaurantId: 'r-1',
}

describe('handleReconfirmationConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendTextMessage).mockResolvedValue({ success: true } as never)
  })

  it('upgrades weak→strong and sends a free-text reply when the window is open', async () => {
    vi.mocked(confirmReconfirmationConsent).mockResolvedValue({ upgraded: true })
    vi.mocked(isWindowOpen).mockResolvedValue(true)

    const handled = await handleReconfirmationConsent(CTX)

    expect(handled).toBe(true)
    expect(confirmReconfirmationConsent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '+85291111111',
    })
    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291111111',
      expect.stringContaining('Confirmed')
    )
  })

  it('returns true and skips the reply when the window is closed', async () => {
    vi.mocked(confirmReconfirmationConsent).mockResolvedValue({ upgraded: true })
    vi.mocked(isWindowOpen).mockResolvedValue(false)

    const handled = await handleReconfirmationConsent(CTX)

    expect(handled).toBe(true)
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('returns false (and sends nothing) when no weak+opted_in row was upgraded (idempotent already-strong)', async () => {
    vi.mocked(confirmReconfirmationConsent).mockResolvedValue({ upgraded: false })

    const handled = await handleReconfirmationConsent(CTX)

    expect(handled).toBe(false)
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(isWindowOpen).not.toHaveBeenCalled()
  })

  it('propagates errors so Kapso can retry (use case is idempotent)', async () => {
    vi.mocked(confirmReconfirmationConsent).mockRejectedValueOnce(
      new Error('connection lost')
    )

    await expect(handleReconfirmationConsent(CTX)).rejects.toThrow(/connection lost/)
  })
})
