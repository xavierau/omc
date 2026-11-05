import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validatePhoneNumberId } from '../validate-phone-number-id'

vi.mock('@/infrastructure/whatsapp/templates', () => ({
  resolveWabaId: vi.fn(),
}))

import { resolveWabaId } from '@/infrastructure/whatsapp/templates'

const mockResolveWabaId = vi.mocked(resolveWabaId)

describe('validatePhoneNumberId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns valid with wabaId on success', async () => {
    mockResolveWabaId.mockResolvedValue('waba-123')

    const result = await validatePhoneNumberId('phone-id-1')

    expect(result).toEqual({ valid: true, wabaId: 'waba-123' })
    expect(mockResolveWabaId).toHaveBeenCalledWith('phone-id-1')
  })

  it('returns error when resolveWabaId returns null', async () => {
    mockResolveWabaId.mockResolvedValue(null)

    const result = await validatePhoneNumberId('bad-id')

    expect(result).toEqual({
      valid: false,
      error: 'Could not resolve WABA ID for this phone number',
    })
  })

  it('returns error when resolveWabaId throws', async () => {
    mockResolveWabaId.mockRejectedValue(new Error('Network error'))

    const result = await validatePhoneNumberId('fail-id')

    expect(result).toEqual({
      valid: false,
      error: 'Failed to validate phone number ID',
    })
  })

  it('returns validation error for empty string', async () => {
    const result = await validatePhoneNumberId('')

    expect(result).toEqual({
      valid: false,
      error: 'kapsoPhoneNumberId is required',
    })
    expect(mockResolveWabaId).not.toHaveBeenCalled()
  })
})
