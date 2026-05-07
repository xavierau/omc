// WONB-008 review fix: AC #6 (NO must revoke). The dispatcher path is:
// `handleOptinRejection` (pending → opted_out) → `handleReconfirmationRejection`
// (weak+opted_in → opted_out). Tests below treat the use case as the unit
// boundary (mocked) so we exercise the webhook glue: revoke flips status +
// event, pending falls through to handleOptinRejection (returns false), and
// no-row returns false.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/application/reject-reconfirmation-consent', () => ({
  rejectReconfirmationConsent: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/conversation-window-repository',
  () => ({ isWindowOpen: vi.fn() })
)

import { handleReconfirmationRejection } from '../reconfirmation-rejection'
import { rejectReconfirmationConsent } from '@/application/reject-reconfirmation-consent'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'

const CTX = {
  phoneNumberId: 'pn-1',
  phone: '+85291111111',
  restaurantId: 'r-1',
}

describe('handleReconfirmationRejection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendTextMessage).mockResolvedValue({ success: true } as never)
  })

  it('weak+opted_in row → revoke + free-text reply when the window is open', async () => {
    vi.mocked(rejectReconfirmationConsent).mockResolvedValue({ revoked: true })
    vi.mocked(isWindowOpen).mockResolvedValue(true)

    const handled = await handleReconfirmationRejection(CTX)

    expect(handled).toBe(true)
    expect(rejectReconfirmationConsent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '+85291111111',
    })
    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291111111',
      expect.stringContaining('marketing')
    )
  })

  it('returns true and skips the reply when the window is closed', async () => {
    vi.mocked(rejectReconfirmationConsent).mockResolvedValue({ revoked: true })
    vi.mocked(isWindowOpen).mockResolvedValue(false)

    const handled = await handleReconfirmationRejection(CTX)

    expect(handled).toBe(true)
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('pending row → use case returns revoked=false → handler returns false (falls through to handleOptinRejection)', async () => {
    vi.mocked(rejectReconfirmationConsent).mockResolvedValue({ revoked: false })

    const handled = await handleReconfirmationRejection(CTX)

    expect(handled).toBe(false)
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(isWindowOpen).not.toHaveBeenCalled()
  })

  it('no matching row → use case returns revoked=false → handler returns false', async () => {
    vi.mocked(rejectReconfirmationConsent).mockResolvedValue({ revoked: false })

    const handled = await handleReconfirmationRejection(CTX)

    expect(handled).toBe(false)
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('propagates errors so Kapso can retry (use case is idempotent)', async () => {
    vi.mocked(rejectReconfirmationConsent).mockRejectedValueOnce(
      new Error('connection lost')
    )

    await expect(handleReconfirmationRejection(CTX)).rejects.toThrow(/connection lost/)
  })
})
