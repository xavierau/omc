import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-admin-repository')
vi.mock('@/infrastructure/supabase/repositories/user-tenant-repository')
vi.mock('@/infrastructure/supabase/client')
vi.mock('../seed-default-welcome-campaign')

import { findBySlug } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { createRestaurant } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { createUserTenant } from '@/infrastructure/supabase/repositories/user-tenant-repository'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { seedDefaultWelcomeCampaign } from '../seed-default-welcome-campaign'
import { createTenant, TenantValidationError } from '../create-tenant'
import type { CreateTenantInput } from '../create-tenant'

const VALID_INPUT: CreateTenantInput = {
  name: 'My Restaurant',
  slug: 'my-restaurant',
  adminEmail: 'admin@test.com',
  adminPassword: 'securePass123',
  whatsappNumber: '+85291234567',
}

describe('TenantValidationError', () => {
  it('has correct name and message', () => {
    const err = new TenantValidationError('Slug is taken')
    expect(err.name).toBe('TenantValidationError')
    expect(err.message).toBe('Slug is taken')
  })

  it('is an instance of Error', () => {
    const err = new TenantValidationError('test')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('createTenant', () => {
  const mockCreateUser = vi.fn()
  const mockSupabase = { auth: { admin: { createUser: mockCreateUser } } }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findBySlug).mockResolvedValue(null)
    vi.mocked(createRestaurant).mockResolvedValue({ id: 'rest-1', slug: 'my-restaurant' } as never)
    vi.mocked(createUserTenant).mockResolvedValue(undefined as never)
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)
    vi.mocked(seedDefaultWelcomeCampaign).mockResolvedValue({ campaignId: 'camp-1' })
    mockCreateUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
  })

  it('throws TenantValidationError when slug is taken', async () => {
    vi.mocked(findBySlug).mockResolvedValue({ id: 'existing' } as never)

    await expect(createTenant(VALID_INPUT)).rejects.toThrow(TenantValidationError)
    await expect(createTenant(VALID_INPUT)).rejects.toThrow('already taken')
  })

  it('creates restaurant, admin user, and user-tenant link', async () => {
    const result = await createTenant(VALID_INPUT)

    expect(createRestaurant).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Restaurant', slug: 'my-restaurant' })
    )
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'admin@test.com', password: 'securePass123' })
    )
    expect(createUserTenant).toHaveBeenCalledWith('user-1', 'rest-1', 'admin')
    expect(result).toEqual({ id: 'rest-1', slug: 'my-restaurant' })
  })

  it('throws when admin user creation fails', async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Email already registered' },
    })

    await expect(createTenant(VALID_INPUT)).rejects.toThrow('Failed to create user')
    await expect(createTenant(VALID_INPUT)).rejects.toThrow('Email already registered')
  })

  it('seeds a default welcome campaign for the new tenant', async () => {
    await createTenant(VALID_INPUT)

    expect(seedDefaultWelcomeCampaign).toHaveBeenCalledWith('rest-1')
  })

  it('does not fail tenant creation when welcome-campaign seeding throws', async () => {
    vi.mocked(seedDefaultWelcomeCampaign).mockRejectedValue(
      new Error('campaigns table unavailable')
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await createTenant(VALID_INPUT)

    expect(result).toEqual({ id: 'rest-1', slug: 'my-restaurant' })
    expect(createUserTenant).toHaveBeenCalledWith('user-1', 'rest-1', 'admin')
    expect(warnSpy).toHaveBeenCalledOnce()
    const warnMessage = warnSpy.mock.calls[0][0] as string
    expect(warnMessage).toContain('seed welcome campaign failed')
    expect(warnMessage).toContain('rest-1')
    expect(warnMessage).toContain('my-restaurant')
    expect(warnMessage).toContain('campaigns table unavailable')

    warnSpy.mockRestore()
  })
})
