// BOOK-001 W3-02: campaigns.book_now_enabled / booking_url (migration 082)
// round-trip through the mapper; a campaign without Book now writes neither
// column, so creates keep working before 082 is applied.
import { describe, it, expect } from 'vitest'
import { bookNowInsertColumns, buildCampaignUpdateRow, mapRowToCampaign } from '../campaign-mapper'

const base = { restaurantId: 'r', name: 'n', type: 'promo' as const, legacyTemplate: '' }

describe('campaign mapper: Book now columns', () => {
  it('reads the columns, defaulting a pre-082 row to off and no URL', () => {
    expect(mapRowToCampaign({ book_now_enabled: true, booking_url: 'https://inline.app/x' })).toMatchObject({
      bookNowEnabled: true,
      bookingUrl: 'https://inline.app/x',
    })
    expect(mapRowToCampaign({})).toMatchObject({ bookNowEnabled: false, bookingUrl: null })
  })

  it('inserts the columns only when set', () => {
    expect(bookNowInsertColumns(base)).toEqual({})
    expect(bookNowInsertColumns({ ...base, bookNowEnabled: false, bookingUrl: null })).toEqual({})
    expect(bookNowInsertColumns({ ...base, bookNowEnabled: true, bookingUrl: 'https://inline.app/x' })).toEqual({
      book_now_enabled: true,
      booking_url: 'https://inline.app/x',
    })
  })

  it('updates the columns when the patch carries them, including clearing the URL', () => {
    expect(buildCampaignUpdateRow({ bookNowEnabled: false, bookingUrl: null })).toEqual({
      book_now_enabled: false,
      booking_url: null,
    })
    expect(buildCampaignUpdateRow({ name: 'x' })).toEqual({ name: 'x' })
  })
})
