// CAMP-016 AC-3: Settings → Campaigns API (R1, R2, R4) and the campaign-form
// recipient count (R2). The repositories are replaced by an in-memory store
// keyed by restaurant id so "row unchanged" and "scoped to the session
// tenant" are observable.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { CampaignAudienceDefaults } from '@/domain/value-objects/audience-filters'
import type { AudienceCounts, AudienceQuery } from '@/domain/value-objects/audience-query'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-audience-defaults-repository', () => ({
  getAudienceDefaults: vi.fn(),
  saveAudienceDefaults: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/campaign-audience-repository', () => ({
  countAudience: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/member-tag-repository', async () => {
  const actual = await vi.importActual<typeof import('@/infrastructure/supabase/repositories/member-tag-repository')>(
    '@/infrastructure/supabase/repositories/member-tag-repository'
  )
  return { ...actual, assertTagsBelongToTenant: vi.fn() }
})

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import {
  getAudienceDefaults,
  saveAudienceDefaults,
} from '@/infrastructure/supabase/repositories/campaign-audience-defaults-repository'
import { countAudience } from '@/infrastructure/supabase/repositories/campaign-audience-repository'
import {
  assertTagsBelongToTenant,
  CrossTenantTagError,
} from '@/infrastructure/supabase/repositories/member-tag-repository'
import { GET, PUT } from '../route'
import { GET as QUALITY } from '../quality/route'
import { POST as COUNT } from '../../../campaigns/audience-count/route'

const R1 = 'rest-1'
const R2 = 'rest-2'
const TAG = '7a000001-0000-4000-8000-000000000001'
const M1 = 'a0000001-0000-4000-8000-000000000001'
const COUNTS: AudienceCounts = { audience: 412, afterLapsed: 136, green: 100, yellow: 18, red: 9, noData: 9, willReceive: 127 }

let store: Record<string, CampaignAudienceDefaults>

function as(role: string, restaurantId = R1) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId, role, tenantStatus: 'active' } as never)
}

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const put = (body: unknown) => PUT(json('/api/dashboard/settings/campaigns', 'PUT', body))
const count = (body: unknown) => COUNT(json('/api/dashboard/campaigns/audience-count', 'POST', body))

beforeEach(() => {
  vi.clearAllMocks()
  store = {
    [R1]: { skipContactQuality: 'red', lapsedAfterDays: 30 },
    [R2]: { skipContactQuality: 'off', lapsedAfterDays: 90 },
  }
  vi.mocked(getAudienceDefaults).mockImplementation(async (rid) => ({ ...store[rid] }))
  vi.mocked(saveAudienceDefaults).mockImplementation(async (rid, d) => {
    store[rid] = { ...d }
    return { ...d }
  })
  vi.mocked(countAudience).mockResolvedValue(COUNTS)
  vi.mocked(assertTagsBelongToTenant).mockResolvedValue(undefined)
})

describe('PUT /api/dashboard/settings/campaigns (R1, R4)', () => {
  it('staff → 403 and the row is unchanged', async () => {
    as('staff')
    const res = await put({ skipContactQuality: 'off', lapsedAfterDays: 10 })
    expect(res.status).toBe(403)
    expect(saveAudienceDefaults).not.toHaveBeenCalled()
    expect(store[R1]).toEqual({ skipContactQuality: 'red', lapsedAfterDays: 30 })
  })

  it.each([
    [{ skipContactQuality: 'yellow', lapsedAfterDays: 30 }, ['skipContactQuality']],
    [{ skipContactQuality: 'red', lapsedAfterDays: 0 }, ['lapsedAfterDays']],
    [{ skipContactQuality: 'red', lapsedAfterDays: 366 }, ['lapsedAfterDays']],
    [{ skipContactQuality: 'red', lapsedAfterDays: 30.5 }, ['lapsedAfterDays']],
    [{ skipContactQuality: 'red', lapsedAfterDays: '30' }, ['lapsedAfterDays']],
    [{}, ['skipContactQuality', 'lapsedAfterDays']],
  ])('admin, invalid %j → 400 naming %j, nothing saved', async (body, fields) => {
    as('admin')
    const res = await put(body)
    expect(res.status).toBe(400)
    expect((await res.json()).fields).toEqual(fields)
    expect(saveAudienceDefaults).not.toHaveBeenCalled()
  })

  it('admin, invalid JSON → 400', async () => {
    as('admin')
    expect((await put('{not json')).status).toBe(400)
  })

  it('admin, valid → persisted; GET then returns it', async () => {
    as('admin')
    const res = await put({ skipContactQuality: 'red_yellow', lapsedAfterDays: 45 })
    expect(res.status).toBe(200)
    expect(store[R1]).toEqual({ skipContactQuality: 'red_yellow', lapsedAfterDays: 45 })
    const got = await (await GET()).json()
    expect(got).toMatchObject({ skipContactQuality: 'red_yellow', lapsedAfterDays: 45 })
  })

  it('a restaurant id in the body is ignored: only the session tenant is written', async () => {
    as('admin', R1)
    await put({ restaurantId: R2, restaurant_id: R2, skipContactQuality: 'off', lapsedAfterDays: 7 })
    expect(saveAudienceDefaults).toHaveBeenCalledWith(R1, { skipContactQuality: 'off', lapsedAfterDays: 7 })
    expect(store[R2]).toEqual({ skipContactQuality: 'off', lapsedAfterDays: 90 })
  })
})

describe('GET /api/dashboard/settings/campaigns', () => {
  it('reads the session tenant only, with thresholds from contact-quality and canEdit by role', async () => {
    as('staff', R2)
    const got = await (await GET()).json()
    expect(getAudienceDefaults).toHaveBeenCalledWith(R2)
    expect(got).toEqual({
      skipContactQuality: 'off',
      lapsedAfterDays: 90,
      thresholds: { greenPercent: 90, yellowPercent: 60, windowDays: 90 },
      canEdit: false,
    })
  })

  it('admin gets canEdit: true', async () => {
    as('admin')
    expect((await (await GET()).json()).canEdit).toBe(true)
  })
})

describe('GET /api/dashboard/settings/campaigns/quality (R2)', () => {
  it('counts every active member of the session tenant and returns aggregates only', async () => {
    as('staff', R2)
    const res = await QUALITY()
    const body = await res.json()
    expect(body).toEqual({ total: 412, green: 100, yellow: 18, red: 9, noData: 9 })
    const q = vi.mocked(countAudience).mock.calls[0][0] as AudienceQuery
    expect(q).toMatchObject({ restaurantId: R2, audience: 'all', lapsedDays: null, skip: 'off' })
  })

  it('a count failure → 500 with a generic message', async () => {
    as('admin')
    vi.mocked(countAudience).mockRejectedValue(new Error('rpc down: secret detail'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await QUALITY()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})

describe('POST /api/dashboard/campaigns/audience-count (R2, R4)', () => {
  const base = { type: 'promo', targetAudience: 'tag', tagIds: [TAG], audienceLapsedDays: 30, audienceSkipQuality: 'red' }

  it('returns aggregates only — no member ids or phones — for the session tenant', async () => {
    as('staff')
    const res = await count({ ...base, targetAudience: 'selected', memberIds: [M1] })
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(
      ['afterLapsed', 'audience', 'audienceLapsedDays', 'audienceSkipQuality', 'green', 'noData', 'red', 'willReceive', 'yellow'].sort()
    )
    expect(JSON.stringify(body)).not.toContain(M1)
    const q = vi.mocked(countAudience).mock.calls[0][0] as AudienceQuery
    expect(q).toMatchObject({ restaurantId: R1, audience: 'selected', memberIds: [M1], lapsedDays: 30, skip: 'red' })
  })

  it('a restaurant id in the body is ignored', async () => {
    as('staff', R1)
    await count({ ...base, restaurantId: R2 })
    expect((vi.mocked(countAudience).mock.calls[0][0] as AudienceQuery).restaurantId).toBe(R1)
  })

  it('omitted filters fall back to the tenant defaults (win-back gets the lapsed days)', async () => {
    as('staff')
    const body = await (await count({ type: 'winback', targetAudience: 'all' })).json()
    expect(body).toMatchObject({ audienceSkipQuality: 'red', audienceLapsedDays: 30 })
  })

  it.each([
    [{ audienceSkipQuality: 'yellow' }],
    [{ audienceLapsedDays: 0 }],
    [{ audienceLapsedDays: 400 }],
    [{ audienceLapsedDays: '30' }],
    [{ targetAudience: 'selected', memberIds: ['not-a-uuid'] }],
    [{ targetAudience: 'tag', tagIds: [] }],
  ])('invalid %j → 400, nothing counted', async (patch) => {
    as('admin')
    const res = await count({ ...base, ...patch })
    expect(res.status).toBe(400)
    expect(countAudience).not.toHaveBeenCalled()
  })

  it("another tenant's tag → 403, nothing counted", async () => {
    as('admin')
    vi.mocked(assertTagsBelongToTenant).mockRejectedValue(new CrossTenantTagError('foreign tag'))
    const res = await count(base)
    expect(res.status).toBe(403)
    expect(countAudience).not.toHaveBeenCalled()
  })
})
