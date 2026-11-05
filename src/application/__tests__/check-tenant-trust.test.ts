import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/tenant-trust-queries',
  () => ({
    getRestaurantCreatedAt: vi.fn(),
    hasRecentQualityIncident: vi.fn(),
    isTenantAutoPaused: vi.fn(),
  })
)

import { isTenantTrusted } from '../check-tenant-trust'
import {
  getRestaurantCreatedAt,
  hasRecentQualityIncident,
  isTenantAutoPaused,
} from '@/infrastructure/supabase/repositories/tenant-trust-queries'

const mockCreatedAt = vi.mocked(getRestaurantCreatedAt)
const mockIncident = vi.mocked(hasRecentQualityIncident)
const mockAutoPaused = vi.mocked(isTenantAutoPaused)

const RESTAURANT_ID = 'rest-1'
const NOW = new Date('2026-04-01T00:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIncident.mockResolvedValue(false)
  mockAutoPaused.mockResolvedValue(false)
})

describe('isTenantTrusted', () => {
  it('denies tenants younger than 90 days with reason=too_new', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(45))
    const result = await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(result.trusted).toBe(false)
    expect(result.reason).toBe('too_new')
  })

  it('denies tenants exactly at 89 days as too_new (boundary)', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(89))
    const result = await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(result.trusted).toBe(false)
    expect(result.reason).toBe('too_new')
  })

  it('allows tenants at exactly 90 days when other gates pass', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(90))
    const result = await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(result.trusted).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('denies with reason=recent_quality_incident when YELLOW/RED in last 90d', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(180))
    mockIncident.mockResolvedValue(true)
    const result = await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(result.trusted).toBe(false)
    expect(result.reason).toBe('recent_quality_incident')
  })

  it('denies with reason=auto_paused when auto_pause_active=true', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(180))
    mockAutoPaused.mockResolvedValue(true)
    const result = await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(result.trusted).toBe(false)
    expect(result.reason).toBe('auto_paused')
  })

  it('trusts old tenants with no incidents and not auto-paused', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(180))
    const result = await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(result.trusted).toBe(true)
  })

  it('checks too_new BEFORE incident (single-DB-call short-circuit on age)', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(10))
    await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(mockIncident).not.toHaveBeenCalled()
    expect(mockAutoPaused).not.toHaveBeenCalled()
  })

  it('passes the 90-day window to hasRecentQualityIncident', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(180))
    await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(mockIncident).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      since: daysAgo(90),
    })
  })

  it('uses Date.now() when `now` is omitted', async () => {
    mockCreatedAt.mockResolvedValue('2010-01-01T00:00:00.000Z')
    const result = await isTenantTrusted({ restaurantId: RESTAURANT_ID })
    expect(result.trusted).toBe(true)
  })

  it('rejects empty restaurantId', async () => {
    await expect(isTenantTrusted({ restaurantId: '' })).rejects.toThrow(
      /restaurantId/
    )
  })

  it('precedence: too_new wins over incident when both would deny', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(45))
    mockIncident.mockResolvedValue(true)
    mockAutoPaused.mockResolvedValue(true)
    const result = await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(result.reason).toBe('too_new')
  })

  it('precedence: incident wins over auto_paused when both would deny', async () => {
    mockCreatedAt.mockResolvedValue(daysAgo(180))
    mockIncident.mockResolvedValue(true)
    mockAutoPaused.mockResolvedValue(true)
    const result = await isTenantTrusted({ restaurantId: RESTAURANT_ID, now: NOW })
    expect(result.reason).toBe('recent_quality_incident')
  })
})
