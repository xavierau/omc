/**
 * CAMP-016 r3 (review F2): saving the audience defaults must never create a
 * tenant_campaign_settings row from column defaults — monthly_send_limit
 * would default to 1,000 and replace the tenant's plan quota. The fake table
 * below applies column defaults the way Postgres does, so an INSERT that
 * omits monthly_send_limit shows up as the 1,000 cap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('../restaurant-repository', () => ({ getRestaurantPlan: vi.fn() }))

import { createServerSupabaseClient } from '../../client'
import { getRestaurantPlan } from '../restaurant-repository'
import { saveAudienceDefaults } from '../campaign-audience-defaults-repository'

type Row = Record<string, unknown>

const COLUMN_DEFAULTS: Row = {
  monthly_send_limit: 1000,
  per_user_marketing_cap: 4,
  skip_contact_quality: 'red',
  lapsed_after_days: 30,
}

function fakeTable(rows: Row[]) {
  const pick = (r: Row, cols: string) => Object.fromEntries(cols.split(',').map((c) => [c.trim(), r[c.trim()]]))
  const insert = (values: Row, ignoreDuplicates: boolean) => {
    const existing = rows.find((r) => r.restaurant_id === values.restaurant_id)
    if (existing && ignoreDuplicates) return
    if (existing) Object.assign(existing, values)
    else rows.push({ ...COLUMN_DEFAULTS, ...values })
  }
  const from = vi.fn(() => ({
    update: (values: Row) => ({
      eq: (col: string, val: unknown) => ({
        select: async (cols: string) => {
          const hit = rows.filter((r) => r[col] === val)
          hit.forEach((r) => Object.assign(r, values))
          return { data: hit.map((r) => pick(r, cols)), error: null }
        },
      }),
    }),
    upsert: (values: Row, opts: { ignoreDuplicates?: boolean } = {}) => {
      insert(values, opts.ignoreDuplicates === true)
      const result = { data: null, error: null }
      return {
        then: (resolve: (v: typeof result) => unknown) => resolve(result),
        select: () => ({
          single: async () => ({ data: pick(rows.find((r) => r.restaurant_id === values.restaurant_id)!, 'skip_contact_quality, lapsed_after_days'), error: null }),
        }),
      }
    },
  }))
  return { from }
}

describe('saveAudienceDefaults', () => {
  let rows: Row[]

  beforeEach(() => {
    rows = []
    vi.mocked(createServerSupabaseClient).mockReturnValue(fakeTable(rows) as never)
    vi.mocked(getRestaurantPlan).mockReset()
  })

  it('a tenant with no settings row gets its plan quota, never the 1,000 column default', async () => {
    vi.mocked(getRestaurantPlan).mockResolvedValue('growth')

    const saved = await saveAudienceDefaults('r-growth', { skipContactQuality: 'red_yellow', lapsedAfterDays: 45 })

    expect(saved).toEqual({ skipContactQuality: 'red_yellow', lapsedAfterDays: 45 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      restaurant_id: 'r-growth',
      monthly_send_limit: 10000,
      skip_contact_quality: 'red_yellow',
      lapsed_after_days: 45,
    })
  })

  it('an existing row keeps its guardrail columns; only the two defaults change', async () => {
    rows.push({ ...COLUMN_DEFAULTS, restaurant_id: 'r-1', monthly_send_limit: 12345, per_user_marketing_cap: 2 })

    await saveAudienceDefaults('r-1', { skipContactQuality: 'off', lapsedAfterDays: 90 })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      monthly_send_limit: 12345,
      per_user_marketing_cap: 2,
      skip_contact_quality: 'off',
      lapsed_after_days: 90,
    })
    expect(getRestaurantPlan).not.toHaveBeenCalled()
  })

  it('a missing restaurant is an error, not a seeded row', async () => {
    vi.mocked(getRestaurantPlan).mockResolvedValue(null)

    await expect(
      saveAudienceDefaults('r-gone', { skipContactQuality: 'red', lapsedAfterDays: 30 })
    ).rejects.toThrow(/saveAudienceDefaults/)
    expect(rows).toHaveLength(0)
  })
})
