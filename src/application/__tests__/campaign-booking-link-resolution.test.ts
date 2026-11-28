// BOOK-001 W3-04 (AC-17): a token minted by a Book now campaign send resolves,
// through W1's resolveBookingLink, to that campaign's booking URL in External
// mode, and to the restaurant default when the campaign has none.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { buildCampaign, buildMember } from '@/test-utils/builders'

vi.mock('@/infrastructure/supabase/repositories/booking-token-repository', () => ({ mintBookingToken: vi.fn() }))

import { mintBookingToken } from '@/infrastructure/supabase/repositories/booking-token-repository'
import { mintCampaignBookingToken } from '../campaign-book-now-context'
import { resolveBookingLink } from '../booking/resolve-booking-link'

const A = 'rest-a'
const TOKEN = 'T'.repeat(43)
const NOW = new Date('2026-11-12T02:00:00.000Z')

let tokens: FakeBookingTokens
let settings: FakeBookingSettings

beforeEach(() => {
  tokens = new FakeBookingTokens()
  settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Kushiro', logoUrl: null, whatsappNumber: '+85220000001' })
  settings.setConfig(A, { mode: 'external', externalUrl: 'https://inline.app/booking/kushiro-default' })
  // The fake mint stores exactly what the campaign send asked for.
  vi.mocked(mintBookingToken).mockImplementation(async (input) => {
    tokens.add({ token: TOKEN, ...input })
    return TOKEN
  })
})

async function sendAndResolve(campaign: ReturnType<typeof buildCampaign>) {
  if (campaign.bookingUrl) settings.campaignUrls.set(campaign.id, { restaurantId: A, url: campaign.bookingUrl })
  const token = await mintCampaignBookingToken(campaign, buildMember({ phone: '+85291234567' }), { ttlHours: 168 })
  return resolveBookingLink({ tokens, settings, now: () => NOW }, token as string)
}

describe('AC-17: campaign booking URL override', () => {
  it('a campaign with booking_url sends the diner to that URL', async () => {
    const campaign = buildCampaign({ id: 'camp-1', restaurantId: A, bookNowEnabled: true, bookingUrl: 'https://inline.app/booking/kushiro-tst' })
    expect(await sendAndResolve(campaign)).toEqual({ kind: 'redirect', url: 'https://inline.app/booking/kushiro-tst' })
  })

  it('a campaign without one falls back to the restaurant externalUrl', async () => {
    const campaign = buildCampaign({ id: 'camp-2', restaurantId: A, bookNowEnabled: true, bookingUrl: null })
    expect(await sendAndResolve(campaign)).toEqual({ kind: 'redirect', url: 'https://inline.app/booking/kushiro-default' })
  })

  it('the minted token is a campaign token bound to that campaign', async () => {
    await sendAndResolve(buildCampaign({ id: 'camp-3', restaurantId: A, bookNowEnabled: true }))
    expect(tokens.rows[0]).toMatchObject({ source: 'campaign', campaignId: 'camp-3', restaurantId: A, phone: '+85291234567' })
  })
})
