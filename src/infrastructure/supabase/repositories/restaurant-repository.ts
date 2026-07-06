import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { TenantPlan } from '@/domain/value-objects/tenant-plan'

export interface RestaurantRow {
  id: string
  slug: string
  name: string
  kapso_phone_number_id: string | null
  meta_business_account_id: string | null
  status: 'active' | 'inactive' | 'trial'
  plan: string
  trial_expires_at: string | null
  logo_url: string | null
  referrer_id: string | null
}

const RESTAURANT_COLUMNS =
  'id, slug, name, kapso_phone_number_id, meta_business_account_id, status, plan, trial_expires_at, logo_url, referrer_id'

export async function getRestaurantPhoneNumberId(
  restaurantId: string
): Promise<string> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('restaurants')
    .select('kapso_phone_number_id')
    .eq('id', restaurantId)
    .single()

  if (error || !data) {
    throw new Error(`Restaurant not found: ${restaurantId}`)
  }

  const phoneNumberId = data.kapso_phone_number_id
  if (!phoneNumberId) {
    console.warn(`[Restaurant] No kapso_phone_number_id for ${restaurantId}`)
    return ''
  }
  return phoneNumberId
}

export async function getRestaurantName(restaurantId: string): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('name')
    .eq('id', restaurantId)
    .single()
  if (error || !data) throw new Error(`Restaurant not found: ${restaurantId}`)
  return data.name ?? ''
}

export async function getMetaBusinessAccountId(restaurantId: string): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('meta_business_account_id')
    .eq('id', restaurantId)
    .single()
  if (error || !data) throw new Error(`Restaurant not found: ${restaurantId}`)
  return (data.meta_business_account_id as string) ?? null
}

export async function updateMetaBusinessAccountId(restaurantId: string, wabaId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ meta_business_account_id: wabaId })
    .eq('id', restaurantId)
  if (error) throw new Error(`Failed to update WABA ID: ${error.message}`)
}

export async function findBySlug(
  slug: string
): Promise<RestaurantRow | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .eq('slug', slug)
    .single()

  if (error || !data) return null
  return data as RestaurantRow
}

export async function findByPhoneNumberId(
  phoneNumberId: string
): Promise<RestaurantRow | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .eq('kapso_phone_number_id', phoneNumberId)
    .single()

  if (error || !data) return null
  return data as RestaurantRow
}

/**
 * Resolve a tenant by Meta's `display_phone_number` (e.g. "85291234567").
 * Used by webhooks like `phone_number_quality_update` that ship ONLY the
 * display number, not the numeric `phone_number_id`. We try the value
 * verbatim and with a leading "+" because `restaurants.whatsapp_number`
 * is stored as `+85291234567` while Meta sends `85291234567`.
 */
export async function findByDisplayPhoneNumber(
  displayPhoneNumber: string
): Promise<RestaurantRow | null> {
  const supabase = createServerSupabaseClient()
  const candidates = displayPhoneNumberCandidates(displayPhoneNumber)
  const { data, error } = await supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .in('whatsapp_number', candidates)
    .maybeSingle()

  if (error || !data) return null
  return data as RestaurantRow
}

function displayPhoneNumberCandidates(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.length === 0) return []
  if (trimmed.startsWith('+')) return [trimmed, trimmed.slice(1)]
  return [trimmed, `+${trimmed}`]
}

export async function listActive(): Promise<RestaurantRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .in('status', ['active', 'trial'])

  if (error) {
    throw new Error(`listActive: ${error.message}`)
  }
  return (data ?? []) as RestaurantRow[]
}

export async function updateRestaurantPlan(
  restaurantId: string,
  plan: TenantPlan
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ plan })
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`Failed to update plan: ${error.message}`)
  }
}

export async function updateLogoUrl(
  restaurantId: string,
  logoUrl: string | null
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ logo_url: logoUrl })
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`Failed to update logo: ${error.message}`)
  }
}

/**
 * Resolve a tenant's contact-redirect config. Runs in the webhook hot path, so
 * it must never throw: on any error / not-found it degrades the feature OFF by
 * returning a null number with the default label.
 */
export async function getRestaurantRedirect(
  restaurantId: string
): Promise<{ redirectNumber: string | null; redirectLabel: string }> {
  const OFF = { redirectNumber: null, redirectLabel: 'Contact us' }
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('restaurants')
      .select('redirect_number, redirect_label')
      .eq('id', restaurantId)
      .single()

    if (error || !data) return OFF
    return {
      redirectNumber: (data.redirect_number as string | null) ?? null,
      // Clamp to 20 chars and coalesce empty/null (|| not ??): the label is used as a
      // WhatsApp CTA displayText / reply-button title (both ≤20), and an empty title
      // makes Meta reject the whole message. Guards legacy/direct-DB writes.
      redirectLabel: ((data.redirect_label as string | null) || 'Contact us').slice(0, 20),
    }
  } catch {
    // Webhook hot path: degrade OFF, never throw (a post-idempotency-claim 500
    // would trigger a provider retry storm and drop the event).
    return OFF
  }
}

export async function updateRestaurantRedirect(
  restaurantId: string,
  redirect: { redirectNumber: string | null; redirectLabel: string }
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({
      redirect_number: redirect.redirectNumber,
      redirect_label: redirect.redirectLabel,
    })
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`Failed to update redirect: ${error.message}`)
  }
}

