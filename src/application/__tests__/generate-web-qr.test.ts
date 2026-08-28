import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('qrcode')

import QRCode from 'qrcode'
import { generateWebQr } from '../generate-web-qr'

describe('generateWebQr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // `as never`: toDataURL's callback overload makes vi.mocked infer void
    vi.mocked(QRCode.toDataURL).mockResolvedValue('data:image/png;base64,mock' as never)
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('builds a plain /join/{slug} URL (no campaign query param)', async () => {
    const result = await generateWebQr('test-slug')

    expect(result.joinUrl).toBe('http://localhost:3000/join/test-slug')
  })

  it('uses NEXT_PUBLIC_APP_URL env var when set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'

    const result = await generateWebQr('my-restaurant')

    expect(result.joinUrl).toBe('https://app.example.com/join/my-restaurant')
  })

  it('returns the generated QR data URL', async () => {
    const result = await generateWebQr('test-slug')

    expect(result.qrDataUrl).toBe('data:image/png;base64,mock')
  })
})
