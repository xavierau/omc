import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { TenantPlan } from '@/domain/value-objects/tenant-plan'
import {
  resolveReplyConfig,
  type ResolvedReplyConfig,
} from '@/domain/services/reply-config'
import {
  resolveContactConfig,
  type ResolvedContactConfig,
} from '@/domain/services/contact-config'

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

/**
 * REPLY-008: the slug that addresses a tenant's public pages. Degrade-safe
 * (`null`, never throws) because its only caller is the webhook's contact
 * ladder, where an unresolvable slug must fall to the next rung rather than
 * break the reply.
 */
export async function getRestaurantSlug(restaurantId: string): Promise<string | null> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('restaurants')
      .select('slug')
      .eq('id', restaurantId)
      .single()
    if (error || !data) return null
    return (data.slug as string | null) ?? null
  } catch {
    return null
  }
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
 * TPL-009: resolve a tenant by WABA id (`entry[].id` on Meta's
 * `message_template_status_update` webhook — the only tenant key that
 * payload carries, since it has neither `phone_number_id` nor
 * `display_phone_number`).
 */
export async function findByBusinessAccountId(
  wabaId: string
): Promise<RestaurantRow | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .eq('meta_business_account_id', wabaId)
    .maybeSingle()

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

/**
 * Resolve a tenant's fallback-reply configuration (REPLY-003): which functions
 * are enabled and any custom EN/ZH copy. Runs in the webhook hot path, so it
 * must never throw: on any error / not-found it degrades to "all functions ON,
 * no custom text" (today's behavior), mirroring `getRestaurantRedirect` and
 * `hasActiveRewards`. Selects ONLY `reply_config` — deliberately NOT part of the
 * shared `RESTAURANT_COLUMNS` constant, so the hot-path webhook is not coupled
 * to this migration.
 */
export async function getReplyConfig(
  restaurantId: string
): Promise<ResolvedReplyConfig> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('restaurants')
      .select('reply_config')
      .eq('id', restaurantId)
      .single()

    if (error || !data) return resolveReplyConfig(undefined)
    return resolveReplyConfig((data as { reply_config?: unknown }).reply_config)
  } catch {
    // Webhook hot path: degrade to defaults, never throw.
    return resolveReplyConfig(undefined)
  }
}

export async function updateReplyConfig(
  restaurantId: string,
  config: ResolvedReplyConfig
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ reply_config: config })
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`Failed to update reply config: ${error.message}`)
  }
}

/**
 * Resolve a tenant's contact-us configuration (REPLY-005): redirect vs form
 * mode, notification email, topics, and acknowledgement text. Runs in the
 * webhook hot path, so it must never throw: on any error / not-found /
 * malformed blob it degrades to `{ mode: 'redirect', ... }` (today's
 * behavior), mirroring `getReplyConfig`. Selects ONLY `contact_config` —
 * deliberately NOT part of the shared `RESTAURANT_COLUMNS` constant, so the
 * hot-path webhook is not coupled to this migration.
 */
export async function getContactConfig(
  restaurantId: string
): Promise<ResolvedContactConfig> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('restaurants')
      .select('contact_config')
      .eq('id', restaurantId)
      .single()

    if (error || !data) return resolveContactConfig(undefined)
    return resolveContactConfig((data as { contact_config?: unknown }).contact_config)
  } catch {
    // Webhook hot path: degrade to redirect defaults, never throw.
    return resolveContactConfig(undefined)
  }
}

export async function updateContactConfig(
  restaurantId: string,
  config: ResolvedContactConfig
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ contact_config: config })
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`Failed to update contact config: ${error.message}`)
  }
}

/**
 * Resolve a tenant's deployed WhatsApp Flow id for the contact-us form
 * (REPLY-007). Each tenant has its own WABA, so this is per-tenant deployment
 * state written only by `updateContactFlowId` — deliberately NOT part of
 * `contact_config` (that JSONB is admin-owned and full-replaced by its PATCH;
 * co-locating would let a settings save clobber a deployed flow id). Runs in
 * the webhook hot path (inside contact-handler's form-mode branch), so it
 * must never throw: on any error (including a pre-059 database where the
 * column doesn't exist yet) or not-found it returns null, which the caller
 * degrades to the redirect path. Selects ONLY whatsapp_contact_flow_id —
 * deliberately NOT part of the shared `RESTAURANT_COLUMNS` constant, so the
 * hot-path webhook is not coupled to this migration.
 *
 * Do NOT use this as a deploy-time idempotency guard — see
 * `getContactFlowIdStrict` below, which the deploy path uses instead.
 */
export async function getContactFlowId(restaurantId: string): Promise<string | null> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('restaurants')
      .select('whatsapp_contact_flow_id')
      .eq('id', restaurantId)
      .single()

    if (error || !data) return null
    return (
      (data as { whatsapp_contact_flow_id?: string | null }).whatsapp_contact_flow_id ?? null
    )
  } catch {
    // Webhook hot path: degrade to "never deployed", never throw.
    return null
  }
}

/**
 * Strict counterpart to `getContactFlowId`, for the deploy path only
 * (`ensure-contact-flow-deployed.ts`'s idempotency guard). The webhook-safe
 * reader collapses every error — query error, missing pre-059 column, a
 * thrown client — to `null`, which is correct for "degrade to redirect" but
 * wrong for "should I deploy a new Flow at Meta": a `null` here must mean
 * "genuinely never deployed", not "the read failed". This throws instead,
 * so a read failure becomes the caller's `ok:false` without ever reaching
 * Meta.
 */
export async function getContactFlowIdStrict(restaurantId: string): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('whatsapp_contact_flow_id')
    .eq('id', restaurantId)
    .single()

  if (error) {
    throw new Error(`Failed to read contact flow id: ${error.message}`)
  }
  if (!data) {
    throw new Error(`Restaurant not found: ${restaurantId}`)
  }
  return (data as { whatsapp_contact_flow_id?: string | null }).whatsapp_contact_flow_id ?? null
}

export async function updateContactFlowId(restaurantId: string, flowId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update({ whatsapp_contact_flow_id: flowId })
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`Failed to update contact flow id: ${error.message}`)
  }
}

/**
 * Conditional write used by the deploy path's concurrent-deploy guard (M1):
 * only persists when the column is still empty, so two racing deploys can't
 * both "win". Returns whether THIS call was the writer that won — `false`
 * means a concurrent deploy already persisted its flow id first, and the
 * caller is responsible for treating its own now-orphaned flow accordingly
 * (best-effort deprecate at Meta). Unlike `updateContactFlowId`, this never
 * overwrites an existing value — the `--force` script path still needs the
 * unconditional overwrite and continues to use `updateContactFlowId`.
 */
export async function updateContactFlowIdIfEmpty(
  restaurantId: string,
  flowId: string
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .update({ whatsapp_contact_flow_id: flowId })
    .eq('id', restaurantId)
    .is('whatsapp_contact_flow_id', null)
    .select('id')

  if (error) {
    throw new Error(`Failed to update contact flow id: ${error.message}`)
  }
  return Boolean(data && data.length > 0)
}

export interface RestaurantEmailContext {
  name: string
  whatsappNumber: string | null
}

/**
 * Resolve the tenant name + business WhatsApp number used to build the
 * REPLY-005 contact-form notification email. Dedicated select (`name,
 * whatsapp_number` only) so the notification path doesn't pull the full
 * `RESTAURANT_COLUMNS` set; degrade-safe (never throws) since it can run in
 * the webhook hot path alongside `getContactConfig`.
 */
export async function getRestaurantEmailContext(
  restaurantId: string
): Promise<RestaurantEmailContext> {
  const DEFAULT: RestaurantEmailContext = { name: '', whatsappNumber: null }
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('restaurants')
      .select('name, whatsapp_number')
      .eq('id', restaurantId)
      .single()

    if (error || !data) return DEFAULT
    return {
      name: (data.name as string | null) ?? '',
      whatsappNumber: (data.whatsapp_number as string | null) ?? null,
    }
  } catch {
    return DEFAULT
  }
}

