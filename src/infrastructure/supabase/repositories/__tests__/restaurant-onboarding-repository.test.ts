import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  getOnboardingSettings,
  updateOnboardingSettings,
} from '../restaurant-onboarding-repository'

function buildSelectMock(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  const single = vi.fn().mockResolvedValue({ data: row, error })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { from, select, eq, single }
}

function buildUpdateMock(error: { message: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ error })
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  return { from, update, eq }
}

describe('getOnboardingSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns both fields when present', async () => {
    const m = buildSelectMock({
      welcome_campaign_id: 'camp-1',
      returning_member_template: 'Welcome back {{name}}',
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    const result = await getOnboardingSettings('rest-1')

    expect(result).toEqual({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: 'Welcome back {{name}}',
    })
  })

  it('returns nulls for unset fields', async () => {
    const m = buildSelectMock({
      welcome_campaign_id: null,
      returning_member_template: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    const result = await getOnboardingSettings('rest-1')

    expect(result).toEqual({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
    })
  })

  it('throws when the restaurant is not found', async () => {
    const m = buildSelectMock(null, { message: 'not found' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await expect(getOnboardingSettings('missing')).rejects.toThrow(
      'restaurant not found'
    )
  })
})

describe('updateOnboardingSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes only welcome_campaign_id when that is the only change', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', { welcomeCampaignId: 'camp-2' })

    expect(m.update).toHaveBeenCalledWith({ welcome_campaign_id: 'camp-2' })
  })

  it('writes only returning_member_template when that is the only change', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', {
      returningMemberTemplate: 'Hi again {{name}}',
    })

    expect(m.update).toHaveBeenCalledWith({
      returning_member_template: 'Hi again {{name}}',
    })
  })

  it('writes null to clear a welcome campaign mapping', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', { welcomeCampaignId: null })

    expect(m.update).toHaveBeenCalledWith({ welcome_campaign_id: null })
  })

  it('is a no-op when no changes are provided', async () => {
    const m = buildUpdateMock()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await updateOnboardingSettings('rest-1', {})

    expect(m.from).not.toHaveBeenCalled()
  })

  it('throws when the update fails', async () => {
    const m = buildUpdateMock({ message: 'boom' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: m.from } as never)

    await expect(
      updateOnboardingSettings('rest-1', { welcomeCampaignId: 'c1' })
    ).rejects.toThrow('boom')
  })
})
