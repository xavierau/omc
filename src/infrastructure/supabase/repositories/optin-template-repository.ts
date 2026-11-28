// WONB-007: thin reads for the inbound-first opt-in flow. Single
// responsibility: resolve the tenant-specific opt-in template id and a
// recent pending marketing consent. Isolated from the broader
// `campaign-settings-repository` to keep its existing tests untouched.

import { createServerSupabaseClient } from '../client'
import { ConsentRecord } from '@/domain/entities/consent-record'
import { PENDING_OPTIN_COOLDOWN_MS } from '@/domain/services/should-prompt-optin'
import { toEntity, type ConsentRecordRow } from './consent-record-mapper'

/**
 * Reads `tenant_campaign_settings.optin_confirmation_template_id`. NULL
 * when the row exists without an override OR when no settings row exists
 * for the tenant — both fall back to the platform default env var.
 */
export async function findOptinTemplateOverride(
  restaurantId: string
): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('tenant_campaign_settings')
    .select('optin_confirmation_template_id')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(`findOptinTemplateOverride: ${error.message}`)
  if (!data) return null
  const id = (data as { optin_confirmation_template_id: string | null })
    .optin_confirmation_template_id
  return id ?? null
}

/**
 * Returns the most recent `pending` marketing consent for the recipient
 * captured within `withinMs` (default 7d). Used as the cooldown gate for
 * `shouldPromptOptin`. Returns null when no qualifying row exists.
 */
export async function findRecentPendingMarketingConsent(args: {
  restaurantId: string
  phoneE164: string
  withinMs?: number
  now?: Date
}): Promise<ConsentRecord | null> {
  const within = args.withinMs ?? PENDING_OPTIN_COOLDOWN_MS
  const cutoff = new Date((args.now ?? new Date()).getTime() - within)
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .select('*')
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
    .eq('category', 'marketing')
    .eq('status', 'pending')
    .gte('captured_at', cutoff.toISOString())
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(`findRecentPendingMarketingConsent: ${error.message}`)
  }
  if (!data) return null
  return toEntity(data as ConsentRecordRow)
}
