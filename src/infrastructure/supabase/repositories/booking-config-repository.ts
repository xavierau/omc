/**
 * BOOK-001: booking settings and the restaurant facts the booking page needs.
 *
 * Each getter selects only its own columns. `booking_config` is deliberately
 * NOT part of `RESTAURANT_COLUMNS` (restaurant-repository.ts), so the webhook
 * hot path is not coupled to migration 082 (memory:
 * principle_shared_select_migration_coupling). Readers never throw: an error
 * resolves to mode off, which is today's behaviour.
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { resolveBookingConfig, isSafeHttpsUrl, type BookingConfig } from '@/domain/value-objects/booking-config'
import type { BookingRestaurantContext, BookingSettingsReader } from '@/domain/ports/booking'

export async function getBookingConfig(restaurantId: string): Promise<BookingConfig> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('restaurants')
      .select('booking_config')
      .eq('id', restaurantId)
      .maybeSingle()
    if (error || !data) return resolveBookingConfig(undefined)
    return resolveBookingConfig((data as { booking_config?: unknown }).booking_config)
  } catch {
    return resolveBookingConfig(undefined)
  }
}

export async function updateBookingConfig(restaurantId: string, config: BookingConfig): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ booking_config: config })
    .eq('id', restaurantId)
  if (error) throw new Error(`Failed to update booking config: ${error.message}`)
}

export async function getBookingRestaurant(restaurantId: string): Promise<BookingRestaurantContext | null> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('restaurants')
      .select('name, logo_url, whatsapp_number')
      .eq('id', restaurantId)
      .maybeSingle()
    if (error || !data) return null
    const row = data as { name: string | null; logo_url: string | null; whatsapp_number: string | null }
    return { name: row.name ?? '', logoUrl: row.logo_url, whatsappNumber: row.whatsapp_number }
  } catch {
    return null
  }
}

/**
 * The campaign's booking URL override, scoped to the token's restaurant so a
 * token can never resolve another tenant's campaign (R15). Re-validated on
 * read: only a stored https URL is ever a redirect target.
 */
export async function getCampaignBookingUrl(campaignId: string, restaurantId: string): Promise<string | null> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('campaigns')
      .select('booking_url')
      .eq('id', campaignId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle()
    if (error || !data) return null
    const url = (data as { booking_url: string | null }).booking_url
    return isSafeHttpsUrl(url) ? url : null
  } catch {
    return null
  }
}

export const bookingSettingsReader: BookingSettingsReader = {
  getConfig: getBookingConfig,
  getRestaurant: getBookingRestaurant,
  getCampaignBookingUrl,
}
