import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendImageMessage: vi.fn(),
  sendTextMessage: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/storage', () => ({
  uploadCouponQr: vi.fn(),
}))

import {
  sendImageMessage,
  sendTextMessage,
} from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { sendWelcomeBody, sendCouponQrImage } from '../onboard-send-helpers'

const TARGET = { phoneNumberId: 'pn-1', phone: '+852999' }

describe('sendWelcomeBody (best-effort per FIX 8)', () => {
  beforeEach(() => {
    vi.mocked(sendImageMessage).mockReset()
    vi.mocked(sendTextMessage).mockReset()
  })

  it('sends an image message with caption when welcomeImageUrl is provided', async () => {
    vi.mocked(sendImageMessage).mockResolvedValueOnce(undefined as never)
    await sendWelcomeBody(TARGET, 'Hi', 'https://cdn/x.png')
    expect(sendImageMessage).toHaveBeenCalledWith(
      'pn-1',
      '+852999',
      'https://cdn/x.png',
      'Hi'
    )
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('falls back to text when no image URL is supplied', async () => {
    vi.mocked(sendTextMessage).mockResolvedValueOnce(undefined as never)
    await sendWelcomeBody(TARGET, 'Hi', null)
    expect(sendTextMessage).toHaveBeenCalledWith('pn-1', '+852999', 'Hi')
  })

  it('DOES NOT throw when sendImageMessage fails — caller continues to QR', async () => {
    vi.mocked(sendImageMessage).mockRejectedValueOnce(new Error('wa image down'))
    await expect(
      sendWelcomeBody(TARGET, 'Hi', 'https://cdn/x.png')
    ).resolves.toBeUndefined()
  })

  it('DOES NOT throw when the text fallback fails', async () => {
    vi.mocked(sendTextMessage).mockRejectedValueOnce(new Error('wa text down'))
    await expect(
      sendWelcomeBody(TARGET, 'Hi', null)
    ).resolves.toBeUndefined()
  })

  it('QR coupon send still fires even when welcome image send threw (integration)', async () => {
    vi.mocked(sendImageMessage).mockRejectedValueOnce(new Error('wa image down'))
    vi.mocked(uploadCouponQr).mockResolvedValueOnce('https://cdn/qr.png')
    vi.mocked(sendImageMessage).mockResolvedValueOnce(undefined as never)

    // Caller pattern from onboard-new-member.ts:
    //   await sendWelcomeBody(...)
    //   await sendCouponQrImage(...)
    // With FIX 8, the first must not block the second.
    await sendWelcomeBody(TARGET, 'Hi', 'https://cdn/x.png')
    await sendCouponQrImage(TARGET, 'CODE-1', 'Your coupon')

    expect(sendImageMessage).toHaveBeenCalledTimes(2)
    expect(sendImageMessage).toHaveBeenLastCalledWith(
      'pn-1',
      '+852999',
      'https://cdn/qr.png',
      'Your coupon'
    )
  })
})
