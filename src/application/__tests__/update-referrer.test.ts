import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/referrer-repository')

import {
  findReferrerById,
  updateReferrer,
} from '@/infrastructure/supabase/repositories/referrer-repository'
import { updateReferrerUseCase } from '../update-referrer'
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

describe('updateReferrerUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not found when referrer does not exist', async () => {
    vi.mocked(findReferrerById).mockResolvedValue(null)

    const result = await updateReferrerUseCase({
      id: 'ref-missing',
      name: 'New Name',
    })

    expect(result).toEqual({
      success: false,
      message: 'Referrer not found.',
    })
    expect(updateReferrer).not.toHaveBeenCalled()
  })

  it('returns success with updated referrer', async () => {
    const existing = buildReferrer()
    const updated = buildReferrer({ name: 'New Name' })

    vi.mocked(findReferrerById).mockResolvedValue(existing)
    vi.mocked(updateReferrer).mockResolvedValue(updated)

    const result = await updateReferrerUseCase({
      id: 'ref-1',
      name: 'New Name',
    })

    expect(result).toEqual({ success: true, referrer: updated })
    expect(updateReferrer).toHaveBeenCalledWith('ref-1', {
      name: 'New Name',
    })
  })

  it('toggles status to inactive', async () => {
    const existing = buildReferrer()
    const updated = buildReferrer({ status: 'inactive' })

    vi.mocked(findReferrerById).mockResolvedValue(existing)
    vi.mocked(updateReferrer).mockResolvedValue(updated)

    const result = await updateReferrerUseCase({
      id: 'ref-1',
      status: 'inactive',
    })

    expect(result).toEqual({ success: true, referrer: updated })
    expect(updateReferrer).toHaveBeenCalledWith('ref-1', {
      status: 'inactive',
    })
  })
})
