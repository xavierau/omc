// INT-001 T-H1: reads/writes `integration_settings`. The mapper NEVER maps
// `outbound_secret_enc` onto `IntegrationSettings` -- `readOutboundSecret()`
// is the ONLY function that decrypts it, and it is intended for the
// delivery path (WI-6) alone. No dashboard route may call it.

import { createServerSupabaseClient } from '../client'
import {
  IntegrationSettings,
  type IntegrationSettingsProps,
  type OutboundStatus,
} from '@/domain/entities/integration-settings'
import { decryptSecret, encryptSecret, secretLast4 } from '@/infrastructure/crypto/secret-box'

// The full row shape, INCLUDING the encrypted secret column -- this type is
// intentionally NOT exported. Any code that needs the row must go through
// one of this file's exported functions, none of which leak the ciphertext.
interface IntegrationSettingsRow {
  integration_id: string
  restaurant_id: string
  new_join_template_id: string | null
  consent_attestation_text: string | null
  consent_attestation_ack_at: string | null
  consent_attestation_ack_by: string | null
  outbound_url: string | null
  outbound_secret_enc: string | null
  outbound_secret_last4: string | null
  outbound_secret_updated_at: string | null
  outbound_secret_updated_by: string | null
  outbound_events: string[]
  outbound_enabled: boolean
  outbound_pii_ack_at: string | null
  outbound_pii_ack_by: string | null
  outbound_status: OutboundStatus
  outbound_failure_streak: number
  outbound_paused_at: string | null
  inbound_rate_per_min: number | null
  inbound_burst: number | null
  inbound_queue_cap: number | null
  inbound_secret_updated_at: string | null
  created_at: string
  updated_at: string
}

// Columns fetched for the ENTITY read path -- deliberately excludes
// `outbound_secret_enc` at the SQL level, not just at the mapper level, so a
// query-shape mistake can't leak the ciphertext over the wire either.
const ENTITY_COLUMNS = [
  'integration_id',
  'restaurant_id',
  'new_join_template_id',
  'consent_attestation_text',
  'consent_attestation_ack_at',
  'consent_attestation_ack_by',
  'outbound_url',
  'outbound_secret_last4',
  'outbound_secret_updated_at',
  'outbound_secret_updated_by',
  'outbound_events',
  'outbound_enabled',
  'outbound_pii_ack_at',
  'outbound_pii_ack_by',
  'outbound_status',
  'outbound_failure_streak',
  'outbound_paused_at',
  'inbound_rate_per_min',
  'inbound_burst',
  'inbound_queue_cap',
  'inbound_secret_updated_at',
  'created_at',
  'updated_at',
].join(', ')

type EntityRow = Omit<IntegrationSettingsRow, 'outbound_secret_enc'>

function toEntity(row: EntityRow): IntegrationSettings {
  const props: IntegrationSettingsProps = {
    integrationId: row.integration_id,
    restaurantId: row.restaurant_id,
    newJoinTemplateId: row.new_join_template_id,
    consentAttestationText: row.consent_attestation_text,
    consentAttestationAckAt: row.consent_attestation_ack_at,
    consentAttestationAckBy: row.consent_attestation_ack_by,
    outboundUrl: row.outbound_url,
    outboundSecretLast4: row.outbound_secret_last4,
    outboundSecretUpdatedAt: row.outbound_secret_updated_at,
    outboundSecretUpdatedBy: row.outbound_secret_updated_by,
    outboundEvents: row.outbound_events,
    outboundEnabled: row.outbound_enabled,
    outboundPiiAckAt: row.outbound_pii_ack_at,
    outboundPiiAckBy: row.outbound_pii_ack_by,
    outboundStatus: row.outbound_status,
    outboundFailureStreak: row.outbound_failure_streak,
    outboundPausedAt: row.outbound_paused_at,
    inboundRatePerMin: row.inbound_rate_per_min,
    inboundBurst: row.inbound_burst,
    inboundQueueCap: row.inbound_queue_cap,
    inboundSecretUpdatedAt: row.inbound_secret_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  return IntegrationSettings.fromProps(props)
}

export async function findIntegrationSettingsById(
  integrationId: string
): Promise<IntegrationSettings | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_settings')
    .select(ENTITY_COLUMNS)
    .eq('integration_id', integrationId)
    .maybeSingle()
  if (error) throw new Error(`findIntegrationSettingsById: ${error.message}`)
  if (!data) return null
  return toEntity(data as unknown as EntityRow)
}

/**
 * Decrypts and returns the outbound signing secret for `integrationId`, or
 * null when none is saved. Intended for the delivery path (WI-6) only --
 * never call this from a dashboard route.
 */
export async function readOutboundSecret(integrationId: string): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_settings')
    .select('outbound_secret_enc')
    .eq('integration_id', integrationId)
    .maybeSingle()
  if (error) throw new Error(`readOutboundSecret: ${error.message}`)
  const enc = (data as { outbound_secret_enc: string | null } | null)?.outbound_secret_enc
  if (!enc) return null
  return decryptSecret(enc)
}

export interface UpdateIntegrationInboundLimitsArgs {
  inboundRatePerMin?: number
  inboundBurst?: number
  inboundQueueCap?: number
}

/**
 * WI-2: platform-admin override of the per-integration inbound rate/queue
 * settings (spec US-5). Writes only the provided fields.
 */
export async function updateIntegrationInboundLimits(
  integrationId: string,
  updates: UpdateIntegrationInboundLimitsArgs
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.inboundRatePerMin !== undefined) row.inbound_rate_per_min = updates.inboundRatePerMin
  if (updates.inboundBurst !== undefined) row.inbound_burst = updates.inboundBurst
  if (updates.inboundQueueCap !== undefined) row.inbound_queue_cap = updates.inboundQueueCap
  const { error } = await supabase
    .from('integration_settings')
    .update(row)
    .eq('integration_id', integrationId)
  if (error) throw new Error(`updateIntegrationInboundLimits: ${error.message}`)
}

export interface SetOutboundSecretArgs {
  integrationId: string
  plaintext: string
  actorUserId: string | null
}

/**
 * Encrypts and stores a new outbound signing secret, replacing whatever was
 * there before. Returns the last-4 for the caller to show once.
 */
export async function setOutboundSecret(
  args: SetOutboundSecretArgs
): Promise<{ last4: string; updatedAt: string }> {
  const supabase = createServerSupabaseClient()
  const now = new Date().toISOString()
  const last4 = secretLast4(args.plaintext)
  const { error } = await supabase
    .from('integration_settings')
    .update({
      outbound_secret_enc: encryptSecret(args.plaintext),
      outbound_secret_last4: last4,
      outbound_secret_updated_at: now,
      outbound_secret_updated_by: args.actorUserId,
    })
    .eq('integration_id', args.integrationId)
  if (error) throw new Error(`setOutboundSecret: ${error.message}`)
  return { last4, updatedAt: now }
}

export interface UpdateIntegrationSettingsFieldsArgs {
  newJoinTemplateId?: string | null
  consentAttestationText?: string | null
  consentAttestationAckAt?: string | null
  consentAttestationAckBy?: string | null
  outboundUrl?: string
  outboundEvents?: string[]
  outboundEnabled?: boolean
  outboundPiiAckAt?: string | null
  outboundPiiAckBy?: string | null
}

/**
 * WI-8: applies an already-validated field patch from `update-integration-
 * settings.ts` in ONE write (never a per-field write -- keeps a
 * multi-field PATCH atomic at the DB level). Only keys present on `updates`
 * are written; `undefined` never appears here (the caller only includes
 * fields the parsed patch actually carried, `null` included where that's a
 * legal value).
 */
export async function updateIntegrationSettingsFields(
  integrationId: string,
  updates: UpdateIntegrationSettingsFieldsArgs
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('newJoinTemplateId' in updates) row.new_join_template_id = updates.newJoinTemplateId
  if ('consentAttestationText' in updates) row.consent_attestation_text = updates.consentAttestationText
  if ('consentAttestationAckAt' in updates) row.consent_attestation_ack_at = updates.consentAttestationAckAt
  if ('consentAttestationAckBy' in updates) row.consent_attestation_ack_by = updates.consentAttestationAckBy
  if ('outboundUrl' in updates) row.outbound_url = updates.outboundUrl
  if ('outboundEvents' in updates) row.outbound_events = updates.outboundEvents
  if ('outboundEnabled' in updates) row.outbound_enabled = updates.outboundEnabled
  if ('outboundPiiAckAt' in updates) row.outbound_pii_ack_at = updates.outboundPiiAckAt
  if ('outboundPiiAckBy' in updates) row.outbound_pii_ack_by = updates.outboundPiiAckBy
  const { error } = await supabase
    .from('integration_settings')
    .update(row)
    .eq('integration_id', integrationId)
  if (error) throw new Error(`updateIntegrationSettingsFields: ${error.message}`)
}

export interface UpdateOutboundBreakerStateArgs {
  integrationId: string
  outboundFailureStreak: number
  outboundStatus?: OutboundStatus
  outboundPausedAt?: string | null
}

/**
 * WI-6: the outbound circuit breaker's ABSOLUTE-write path -- reset to 0
 * on a delivered success, and resume-outbound.ts's `outboundStatus:
 * 'active'` + streak-reset-to-0. I-8: no longer used for the transient-
 * failure INCREMENT (see `incrementOutboundFailureStreak` below) -- a
 * plain `.update()` with a client-computed `streak + 1` is a
 * read-modify-write that loses updates under concurrent transient
 * failures to the same integration.
 */
export async function updateOutboundBreakerState(args: UpdateOutboundBreakerStateArgs): Promise<void> {
  const supabase = createServerSupabaseClient()
  const row: Record<string, unknown> = {
    outbound_failure_streak: args.outboundFailureStreak,
    updated_at: new Date().toISOString(),
  }
  if (args.outboundStatus !== undefined) row.outbound_status = args.outboundStatus
  if (args.outboundPausedAt !== undefined) row.outbound_paused_at = args.outboundPausedAt
  const { error } = await supabase
    .from('integration_settings')
    .update(row)
    .eq('integration_id', args.integrationId)
  if (error) throw new Error(`updateOutboundBreakerState: ${error.message}`)
}

/**
 * I-8: atomic increment for the ONE case that's actually a
 * read-modify-write under concurrency -- a transient delivery failure
 * bumping the streak by 1. Routed through migration 075's
 * `increment_outbound_failure_streak` RPC, which does the `+1` and the
 * threshold-trip (`outbound_status -> paused_auto`) inside Postgres in one
 * statement, so concurrent callers serialize on the row's own lock instead
 * of racing on a client-side `snapshot.outboundFailureStreak + 1`. Returns
 * the streak AS OF this caller's own increment (never a value a
 * concurrent increment already overwrote), or `null` if the integration
 * row doesn't exist.
 */
export async function incrementOutboundFailureStreak(
  integrationId: string,
  threshold: number,
  now: Date
): Promise<number | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('increment_outbound_failure_streak', {
    p_integration_id: integrationId,
    p_threshold: threshold,
    p_now: now.toISOString(),
  })
  if (error) throw new Error(`incrementOutboundFailureStreak: ${error.message}`)
  return (data as number | null) ?? null
}
