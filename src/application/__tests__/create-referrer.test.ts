import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/referrer-repository')

import { createReferrer } from '@/infrastructure/supabase/repositories/referrer-repository'
import { createReferrerUseCase } from '../create-referrer'
import type { Referrer } from '@/domain/entities/referrer'

function buildReferrer(overrides: Partial<Referrer> = {}): Referrer {
  return {
    id: 'ref-1',
    name: 'Acme Corp',
    contactEmail: 'acme@example.com',
    contactPhone: null,
    commissionPerMessageHkd: 0.05,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('createReferrerUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns success with created referrer', async () => {
    const expected = buildReferrer()
    vi.mocked(createReferrer).mockResolvedValue(expected)

    const result = await createReferrerUseCase({
      name: 'Acme Corp',
      contactEmail: 'acme@example.com',
    })

    expect(result).toEqual({ success: true, referrer: expected })
    expect(createReferrer).toHaveBeenCalledWith({
      name: 'Acme Corp',
      contactEmail: 'acme@example.com',
    })
  })

  it('passes optional fields to repository', async () => {
    vi.mocked(createReferrer).mockResolvedValue(buildReferrer())

    await createReferrerUseCase({
      name: 'Test',
      contactEmail: 'test@example.com',
      contactPhone: '+852 1234',
      commissionPerMessageHkd: 0.1,
    })

    expect(createReferrer).toHaveBeenCalledWith({
      name: 'Test',
      contactEmail: 'test@example.com',
      contactPhone: '+852 1234',
      commissionPerMessageHkd: 0.1,
    })
  })

  it('returns failure when repository throws', async () => {
    vi.mocked(createReferrer).mockRejectedValue(
      new Error('DB connection lost')
    )

    const result = await createReferrerUseCase({
      name: 'Test',
      contactEmail: 'test@example.com',
    })

    expect(result).toEqual({
      success: false,
      message: 'DB connection lost',
    })
  })
})
