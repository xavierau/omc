import { describe, it, expect } from 'vitest'
import {
  initialStampCampaignForm,
  validateStampCampaignForm,
  buildStampCampaignBody,
  type StampCampaignFormState,
} from '@/components/dashboard/stamp-campaign-form-types'

function form(overrides: Partial<StampCampaignFormState> = {}): StampCampaignFormState {
  return {
    name: 'Coffee Card',
    nameZh: '咖啡卡',
    stampsRequired: '10',
    rewardId: 'rw-1',
    maxStampsPerDay: '1',
    ...overrides,
  }
}

describe('validateStampCampaignForm', () => {
  it('returns null for a valid form', () => {
    expect(validateStampCampaignForm(form())).toBeNull()
  })

  it('requires a name', () => {
    expect(validateStampCampaignForm(form({ name: '  ' }))).toBe('formName')
  })

  it('requires a positive integer stampsRequired', () => {
    expect(validateStampCampaignForm(form({ stampsRequired: '0' }))).toBe('formStampsRequired')
    expect(validateStampCampaignForm(form({ stampsRequired: '2.5' }))).toBe('formStampsRequired')
  })

  it('requires a reward', () => {
    expect(validateStampCampaignForm(form({ rewardId: '' }))).toBe('formReward')
  })

  it('requires a positive integer maxStampsPerDay', () => {
    expect(validateStampCampaignForm(form({ maxStampsPerDay: '0' }))).toBe('formMaxPerDay')
  })
})

describe('buildStampCampaignBody', () => {
  it('trims strings, coerces numbers, and nulls an empty zh name', () => {
    const body = buildStampCampaignBody(form({ name: '  Card  ', nameZh: '  ' }))
    expect(body).toEqual({
      name: 'Card',
      nameZh: null,
      stampsRequired: 10,
      rewardId: 'rw-1',
      maxStampsPerDay: 1,
    })
  })

  it('keeps a provided zh name', () => {
    expect(buildStampCampaignBody(form()).nameZh).toBe('咖啡卡')
  })
})

describe('initialStampCampaignForm', () => {
  it('defaults the daily cap to 1', () => {
    expect(initialStampCampaignForm.maxStampsPerDay).toBe('1')
  })
})
