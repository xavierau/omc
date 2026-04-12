import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('qrcode')

import QRCode from 'qrcode'
import { generateWebQr } from '../generate-web-qr'

describe('generateWebQr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(QRCode.toDataURL).mockResolvedValue('data:image/png;base64,mock')
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('builds URL without campaign param', async () => {
    const result = await generateWebQr('test-slug')

    expect(result.joinUrl).toBe('http://localhost:3000/join/test-slug')
  })

  it('builds URL with campaign param when provided', async () => {
    const result = await generateWebQr('test-slug', 'camp-1')

    expect(result.joinUrl).toBe(
      'http://localhost:3000/join/test-slug?campaign=camp-1'
    )
  })

  it('uses NEXT_PUBLIC_APP_URL env var when set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'

    const result = await generateWebQr('my-restaurant')

    expect(result.joinUrl).toBe(
      'https://app.example.com/join/my-restaurant'
    )
  })
})
