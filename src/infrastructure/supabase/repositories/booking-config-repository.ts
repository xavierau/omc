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
import {
  applyBookingSettings,
  resolveBookingConfig,
  isSafeHttpsUrl,
  type BookingConfig,
  type BookingTemplateKind,
} from '@/domain/value-objects/booking-config'
import {
  applyBookingTemplateEdit,
  applyBookingTemplatePromotion,
  applyProvisionedTemplates,
  type BookingTemplateEdit,
  type ProvisionedSlot,
} from '@/domain/services/booking-template-slot'
import type { LanguageCode } from '@/domain/value-objects/language'
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

/**
 * BOOK-002 F1 C2: every booking_config writer is a compare-and-swap on the
 * stored revision `booking_config.rev`. It reads the raw value, applies its
 * own change to it, and writes with the revision bumped only while the stored
 * revision is still the one it read. A lost race re-reads and re-applies the
 * change, so concurrent writers to different fields never erase each other.
 * A row written before revisions existed has no rev and is guarded on its
 * absence. The guard is the small rev value, not the whole previous blob: as
 * a filter, a blob with eight 1,024-character bodies is a ~41 KB URL, past
 * common gateway URL limits. `change`
 * returns null for "nothing to write"; the function then returns null too.
 */
const CAS_ATTEMPTS = 5
type ConfigChange = (current: BookingConfig) => BookingConfig | null

async function readRaw(restaurantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await createServerSupabaseClient()
    .from('restaurants')
    .select('booking_config')
    .eq('id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read booking config: ${error.message}`)
  const raw = (data as { booking_config?: unknown } | null)?.booking_config
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
}

async function writeIfUnchanged(restaurantId: string, rev: unknown, next: BookingConfig): Promise<boolean> {
  const query = createServerSupabaseClient()
    .from('restaurants')
    .update({ booking_config: { ...next, rev: Number.isInteger(rev) ? (rev as number) + 1 : 1 } })
    .eq('id', restaurantId)
  const guarded = rev === undefined || rev === null ? query.is('booking_config->>rev', null) : query.eq('booking_config->>rev', String(rev))
  const { data, error } = await guarded.select('id')
  if (error) throw new Error(`Failed to update booking config: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

export async function changeBookingConfig(restaurantId: string, change: ConfigChange): Promise<BookingConfig | null> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const raw = await readRaw(restaurantId)
    const next = change(resolveBookingConfig(raw ?? undefined))
    if (!next) return null
    if (await writeIfUnchanged(restaurantId, raw?.rev, next)) return next
  }
  throw new Error('Failed to update booking config: changed concurrently')
}

/** The settings PUT: only the form's fields, onto the stored config (never stale template ids). */
export async function saveBookingSettings(restaurantId: string, settings: BookingConfig): Promise<void> {
  await changeBookingConfig(restaurantId, (current) => applyBookingSettings(current, settings))
}

/** W3 provisioning: only the slots it submitted (BOOK-002 F1 C7: and their stale edits). */
export async function saveProvisionedBookingTemplates(restaurantId: string, slots: ProvisionedSlot[]): Promise<void> {
  await changeBookingConfig(restaurantId, (current) => applyProvisionedTemplates(current, slots))
}

/** BOOK-002: one message edit, applied to the stored config. */
export async function saveBookingTemplateEdit(restaurantId: string, edit: BookingTemplateEdit): Promise<void> {
  await changeBookingConfig(restaurantId, (current) => applyBookingTemplateEdit(current, edit))
}

/**
 * BOOK-002: promote an approved candidate into templateIds. True only for
 * the caller whose write moved it: of concurrent senders exactly one wins,
 * and an edit that replaced the candidate meanwhile also wins over it.
 */
export async function promoteBookingTemplateCandidate(
  restaurantId: string,
  kind: BookingTemplateKind,
  language: LanguageCode,
  candidateId: string
): Promise<boolean> {
  const next = await changeBookingConfig(restaurantId, (current) => applyBookingTemplatePromotion(current, { kind, language }, candidateId))
  return next !== null
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
