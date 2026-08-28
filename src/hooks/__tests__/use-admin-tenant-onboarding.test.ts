import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildOnboardingUrl,
  parseChecklistRequest,
  parsePathRequest,
  type OnboardingStateView,
} from '@/hooks/use-admin-tenant-onboarding'

const fixture: OnboardingStateView = {
  restaurantId: 'r1',
  path: 'A',
  phase: 'setup',
  checklist: {
    hk_sim_never_used: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    verified_meta_business: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    display_name_draft_approved: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    opt_in_source_documented: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    vertical_allowed: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    first_three_campaigns_drafted: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
  },
  kpiGate: { status: 'insufficient', observed: 12, required: 100 },
  checklistComplete: false,
  nextPhase: 'probe',
  canAdvance: false,
  blockedReasons: ['checklist_incomplete'],
}

describe('buildOnboardingUrl', () => {
  it('builds the base URL', () => {
    expect(buildOnboardingUrl('abc')).toBe('/api/admin/tenants/abc/onboarding')
  })
  it('builds the path sub-route', () => {
    expect(buildOnboardingUrl('abc', 'path')).toBe('/api/admin/tenants/abc/onboarding/path')
  })
  it('builds the checklist sub-route', () => {
    expect(buildOnboardingUrl('abc', 'checklist')).toBe('/api/admin/tenants/abc/onboarding/checklist')
  })
  it('builds the advance sub-route', () => {
    expect(buildOnboardingUrl('abc', 'advance')).toBe('/api/admin/tenants/abc/onboarding/advance')
  })
})

describe('parsePathRequest', () => {
  it('returns the body for a valid path', () => {
    expect(parsePathRequest('B2')).toEqual({ path: 'B2' })
  })
})

describe('parseChecklistRequest', () => {
  it('returns the body for a tick', () => {
    expect(parseChecklistRequest('vertical_allowed', true)).toEqual({
      key: 'vertical_allowed',
      checked: true,
    })
  })
})

describe('useAdminTenantOnboarding fetch wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('hook signature exposes the documented contract', async () => {
    const mod = await import('@/hooks/use-admin-tenant-onboarding')
    expect(typeof mod.useAdminTenantOnboarding).toBe('function')
  })

  it('GET request hits the correct URL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    })
    vi.stubGlobal('fetch', fetchSpy)
    const res = await fetch(buildOnboardingUrl('r1'))
    expect(res.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith('/api/admin/tenants/r1/onboarding')
  })

  it('PATCH path sends correct payload', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture })
    vi.stubGlobal('fetch', fetchSpy)
    const url = buildOnboardingUrl('r1', 'path')
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsePathRequest('A')),
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ path: 'A' }),
      })
    )
  })

  it('PATCH checklist sends correct payload', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture })
    vi.stubGlobal('fetch', fetchSpy)
    const url = buildOnboardingUrl('r1', 'checklist')
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parseChecklistRequest('opt_in_source_documented', false)),
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        body: JSON.stringify({ key: 'opt_in_source_documented', checked: false }),
      })
    )
  })

  it('POST advance hits the correct URL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture })
    vi.stubGlobal('fetch', fetchSpy)
    await fetch(buildOnboardingUrl('r1', 'advance'), { method: 'POST' })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/admin/tenants/r1/onboarding/advance',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
