import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('qrcode')

import QRCode from 'qrcode'
import { generateQr } from '../generate-qr'

describe('generateQr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(QRCode.toDataURL).mockResolvedValue('data:image/png;base64,mock')
  })

  it('builds deep link with + stripped from number', async () => {
    const result = await generateQr({
      whatsappNumber: '+85291234567',
    })

    expect(result.deepLink).toBe(
      'https://wa.me/85291234567?text=JOIN'
    )
  })

  it('returns qrDataUrl from QRCode.toDataURL', async () => {
    const result = await generateQr({
      whatsappNumber: '+85291234567',
    })

    expect(result.qrDataUrl).toBe('data:image/png;base64,mock')
  })

  it('calls QRCode.toDataURL with correct options', async () => {
    await generateQr({
      whatsappNumber: '+85291234567',
    })

    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      'https://wa.me/85291234567?text=JOIN',
      expect.objectContaining({
        width: 300,
        errorCorrectionLevel: 'H',
      })
    )
  })
})
