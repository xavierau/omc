import { describe, it, expect } from 'vitest'
import {
  audienceCountBody,
  audienceFilterFields,
  filtersFromCampaign,
  prefillFromDefaults,
  lapsedForType,
} from '@/components/dashboard/campaign-audience-filter-state'
import { buildCampaignRequestBody, initialCampaignForm, validateCampaignForm } from '@/components/dashboard/campaign-form-types'
import type { Campaign } from '@/domain/entities/campaign'

const TAG = '7a000001-0000-4000-8000-000000000001'

describe('campaign form audience filters (CAMP-016)', () => {
  it('pre-fills days and quality from the Settings defaults, never the lapsed toggle', () => {
    expect(prefillFromDefaults({ skipContactQuality: 'red_yellow', lapsedAfterDays: 45 })).toEqual({
      lapsedDays: '45', skipEnabled: true, skipLevel: 'red_yellow',
    })
    expect(prefillFromDefaults({ skipContactQuality: 'off', lapsedAfterDays: 30 })).not.toHaveProperty('lapsedEnabled')
    expect(prefillFromDefaults({ skipContactQuality: 'off', lapsedAfterDays: 30 }).skipEnabled).toBe(false)
  })

  it('a type change turns the lapsed filter on for win-back and off otherwise, unless the user set it', () => {
    expect(lapsedForType('winback', false, true)).toBe(true)
    expect(lapsedForType('promo', true, false)).toBe(false)
    expect(lapsedForType('promo', true, true)).toBe(true)
    expect(lapsedForType('promo', false, true)).toBe(false)
  })

  it('an edit starts from the campaign snapshot', () => {
    const c = { type: 'promo', audienceSkipQuality: 'red', audienceLapsedDays: 60, schedule: null } as unknown as Campaign
    expect(filtersFromCampaign(c)).toEqual({ lapsedEnabled: true, lapsedDays: '60', skipEnabled: true, skipLevel: 'red' })
  })

  it('create and count send the same filter fields', () => {
    const form = { ...initialCampaignForm, type: 'promo', targetAudience: 'tag' as const, tagIds: [TAG], lapsedEnabled: true, lapsedDays: '30', skipEnabled: true, skipLevel: 'red' as const }
    const create = buildCampaignRequestBody(form)
    const count = audienceCountBody(form)!
    expect(count).toMatchObject({ audienceSkipQuality: 'red', audienceLapsedDays: 30, tagIds: [TAG] })
    expect({ s: create.audienceSkipQuality, l: create.audienceLapsedDays }).toEqual({ s: count.audienceSkipQuality, l: count.audienceLapsedDays })
  })

  it('off filters send skip off and no lapsed days', () => {
    expect(audienceFilterFields({ lapsedEnabled: false, lapsedDays: '30', skipEnabled: false, skipLevel: 'red' }))
      .toEqual({ audienceSkipQuality: 'off', audienceLapsedDays: null })
  })

  it.each(['0', '366', '', '3.5', 'abc'])('lapsed days %j blocks create and the count', (lapsedDays) => {
    const form = { ...initialCampaignForm, name: 'x', templateEn: 'hi', type: 'promo', lapsedEnabled: true, lapsedDays }
    expect(validateCampaignForm(form)).toBe('lapsedDaysInvalid')
    expect(audienceCountBody(form)).toBeNull()
  })

  it('nothing to count for welcome, an empty tag pick or an empty selection', () => {
    const base = { ...initialCampaignForm }
    expect(audienceCountBody({ ...base, type: 'welcome' })).toBeNull()
    expect(audienceCountBody({ ...base, targetAudience: 'tag', tagIds: [] })).toBeNull()
    expect(audienceCountBody({ ...base, targetAudience: 'selected', memberIds: [] })).toBeNull()
  })

  it('a welcome campaign sends no audience filters', () => {
    const body = buildCampaignRequestBody({ ...initialCampaignForm, type: 'welcome' })
    expect(body).not.toHaveProperty('audienceSkipQuality')
    expect(body).not.toHaveProperty('audienceLapsedDays')
  })
})
