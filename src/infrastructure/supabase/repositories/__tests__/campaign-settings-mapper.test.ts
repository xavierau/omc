import { describe, it, expect } from 'vitest'
import {
  mapRowToSettings,
  mapSettingsToUpsert,
  type CampaignSettingsRow,
} from '../campaign-settings-mapper'

function buildRow(
  overrides: Partial<CampaignSettingsRow> = {}
): CampaignSettingsRow {
  return {
    id: 'cs-1',
    restaurant_id: 'rest-1',
    monthly_send_limit: 1000,
    daily_campaign_limit: 1,
    max_unsubscribe_rate: '0.0500',
    campaign_paused: false,
    paused_reason: null,
    paused_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

describe('mapRowToSettings', () => {
  it('maps all fields from DB row to domain type', () => {
    const row = buildRow()
    const result = mapRowToSettings(row)

    expect(result).toEqual({
      restaurantId: 'rest-1',
      monthlySendLimit: 1000,
      dailyCampaignLimit: 1,
      maxUnsubscribeRate: 0.05,
      campaignPaused: false,
      pausedReason: undefined,
      pausedAt: undefined,
      // WAQ-007: column added in migration 040 — defaults to 1 when the row
      // pre-dates the migration (per_user_marketing_cap absent on read).
      perUserMarketingCap: 1,
    })
  })

  it('reads per_user_marketing_cap from the row when set', () => {
    const row = buildRow({ per_user_marketing_cap: 2 })
    expect(mapRowToSettings(row).perUserMarketingCap).toBe(2)
  })

  it('defaults to 1 when per_user_marketing_cap is absent (pre-migration row)', () => {
    const row = buildRow()
    expect(mapRowToSettings(row).perUserMarketingCap).toBe(1)
  })

  it('maps paused state with reason and date', () => {
    const row = buildRow({
      campaign_paused: true,
      paused_reason: 'High unsub rate',
      paused_at: '2026-03-15T10:00:00Z',
    })
    const result = mapRowToSettings(row)

    expect(result.campaignPaused).toBe(true)
    expect(result.pausedReason).toBe('High unsub rate')
    expect(result.pausedAt).toEqual(new Date('2026-03-15T10:00:00Z'))
  })

  it('converts max_unsubscribe_rate string to number', () => {
    const row = buildRow({ max_unsubscribe_rate: '0.1000' })
    expect(mapRowToSettings(row).maxUnsubscribeRate).toBe(0.1)
  })
})

describe('mapSettingsToUpsert', () => {
  it('maps partial domain settings to DB columns', () => {
    const result = mapSettingsToUpsert('rest-1', {
      monthlySendLimit: 2000,
      campaignPaused: true,
      pausedReason: 'Manual pause',
    })

    expect(result).toEqual({
      restaurant_id: 'rest-1',
      monthly_send_limit: 2000,
      campaign_paused: true,
      paused_reason: 'Manual pause',
    })
  })

  it('clears paused fields when set to null', () => {
    const result = mapSettingsToUpsert('rest-1', {
      campaignPaused: false,
      pausedReason: null,
      pausedAt: null,
    })

    expect(result).toEqual({
      restaurant_id: 'rest-1',
      campaign_paused: false,
      paused_reason: null,
      paused_at: null,
    })
  })

  it('converts pausedAt Date to ISO string', () => {
    const date = new Date('2026-03-15T10:00:00Z')
    const result = mapSettingsToUpsert('rest-1', { pausedAt: date })

    expect(result.paused_at).toBe('2026-03-15T10:00:00.000Z')
  })

  it('omits undefined fields', () => {
    const result = mapSettingsToUpsert('rest-1', {
      monthlySendLimit: 500,
    })

    expect(result).toEqual({
      restaurant_id: 'rest-1',
      monthly_send_limit: 500,
    })
    expect(result).not.toHaveProperty('campaign_paused')
  })

  it('writes per_user_marketing_cap to the upsert row when provided', () => {
    const result = mapSettingsToUpsert('rest-1', { perUserMarketingCap: 2 })
    expect(result).toEqual({
      restaurant_id: 'rest-1',
      per_user_marketing_cap: 2,
    })
  })
})
