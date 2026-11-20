import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/application/confirm-marketing-optin', () => ({
  confirmMarketingOptin: vi.fn(),
}))
vi.mock('@/application/reject-marketing-optin', () => ({
  rejectMarketingOptin: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/conversation-window-repository',
  () => ({
    isWindowOpen: vi.fn(),
  })
)

import {
  handleOptinConfirmation,
  handleOptinRejection,
} from '../optin-confirmation'
import { confirmMarketingOptin } from '@/application/confirm-marketing-optin'
import { rejectMarketingOptin } from '@/application/reject-marketing-optin'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'

const CTX = {
  phoneNumberId: 'pn-1',
  phone: '+85291111111',
  restaurantId: 'r-1',
}

describe('handleOptinConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendTextMessage).mockResolvedValue({ success: true } as never)
  })

  it('returns true and sends a thank-you reply when the window is open', async () => {
    vi.mocked(confirmMarketingOptin).mockResolvedValue({ upgraded: true })
    vi.mocked(isWindowOpen).mockResolvedValue(true)

    const handled = await handleOptinConfirmation(CTX)

    expect(handled).toBe(true)
    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291111111',
      expect.stringContaining("offers")
    )
  })

  it('returns true and skips the reply when the window is closed (no utility template available)', async () => {
    vi.mocked(confirmMarketingOptin).mockResolvedValue({ upgraded: true })
    vi.mocked(isWindowOpen).mockResolvedValue(false)

    const handled = await handleOptinConfirmation(CTX)

    expect(handled).toBe(true)
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('returns false (and sends nothing) when no pending row was upgraded', async () => {
    vi.mocked(confirmMarketingOptin).mockResolvedValue({ upgraded: false })

    const handled = await handleOptinConfirmation(CTX)

    expect(handled).toBe(false)
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(isWindowOpen).not.toHaveBeenCalled()
  })
})

describe('handleOptinRejection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendTextMessage).mockResolvedValue({ success: true } as never)
  })

  it('returns true and sends a confirmation reply when the window is open', async () => {
    vi.mocked(rejectMarketingOptin).mockResolvedValue({ revoked: true })
    vi.mocked(isWindowOpen).mockResolvedValue(true)

    const handled = await handleOptinRejection(CTX)

    expect(handled).toBe(true)
    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291111111',
      expect.stringContaining('no offers')
    )
  })

  it('returns true and skips the reply when the window is closed', async () => {
    vi.mocked(rejectMarketingOptin).mockResolvedValue({ revoked: true })
    vi.mocked(isWindowOpen).mockResolvedValue(false)

    const handled = await handleOptinRejection(CTX)

    expect(handled).toBe(true)
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('returns false when no pending row was revoked', async () => {
    vi.mocked(rejectMarketingOptin).mockResolvedValue({ revoked: false })

    const handled = await handleOptinRejection(CTX)

    expect(handled).toBe(false)
    expect(sendTextMessage).not.toHaveBeenCalled()
  })
})
