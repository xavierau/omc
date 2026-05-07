// WONB-008 reconfirmation campaign queries. Extracted from
// `consent-record-repository.ts` and `campaign-settings-repository.ts` so
// each writer file stays under the size limit. Re-exported from the
// origin files so existing import sites keep working.

import { createServerSupabaseClient } from '../client'

export interface ReconfirmationAudienceRow {
  memberId: string
  phoneE164: string
  preferredLanguage: 'en' | 'zh_hk' | null
}

interface ReconfirmationAudienceArgs {
  restaurantId: string
  limit: number
}

interface AudienceMemberEmbed {
  id: string
  phone_e164: string
  preferred_language: 'en' | 'zh_hk' | null
}

interface AudienceJoinedRow {
  // PostgREST returns embedded FK as either an object or array depending on
  // schema introspection; handle both so type-checking and runtime line up.
  members: AudienceMemberEmbed | AudienceMemberEmbed[] | null
}

// Members joined with consent_records WHERE grade='weak' AND
// status='opted_in' AND category='marketing'. Sorted captured_at DESC, capped.
// Single round-trip via PostgREST inner-join. Orphaned consent rows (members
// embed = null) are silently skipped.
export async function findReconfirmationAudience(
  args: ReconfirmationAudienceArgs
): Promise<ReconfirmationAudienceRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .select('captured_at, members:member_id(id, phone_e164, preferred_language)')
    .eq('restaurant_id', args.restaurantId)
    .eq('category', 'marketing')
    .eq('status', 'opted_in')
    .eq('consent_grade', 'weak')
    .order('captured_at', { ascending: false })
    .limit(args.limit)
  if (error) throw new Error(`findReconfirmationAudience: ${error.message}`)
  return mapAudienceRows((data ?? []) as unknown as AudienceJoinedRow[])
}

function mapAudienceRows(
  rows: AudienceJoinedRow[]
): ReconfirmationAudienceRow[] {
  const out: ReconfirmationAudienceRow[] = []
  for (const r of rows) {
    const m = pickMemberEmbed(r.members)
    if (!m) continue
    out.push({
      memberId: m.id,
      phoneE164: m.phone_e164,
      preferredLanguage: m.preferred_language ?? null,
    })
  }
  return out
}

function pickMemberEmbed(
  embed: AudienceMemberEmbed | AudienceMemberEmbed[] | null
): AudienceMemberEmbed | null {
  if (!embed) return null
  if (Array.isArray(embed)) return embed[0] ?? null
  return embed
}

// Count whatsapp_messages queued today for any reconfirmation campaign owned
// by this tenant. The cap is per-tenant (sum across all reconfirmation
// campaigns), so we look up the campaign IDs first then COUNT in one
// round-trip via `IN (...)`. Skips the count entirely when the tenant has
// no reconfirmation campaigns yet.
export async function getReconfirmationSendsToday(
  restaurantId: string
): Promise<number> {
  const supabase = createServerSupabaseClient()
  const ids = await fetchReconfirmationCampaignIds(supabase, restaurantId)
  if (ids.length === 0) return 0
  const { count, error } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .in('campaign_id', ids)
    .gte('queued_at', todayStart())
  if (error) throw new Error(`getReconfirmationSendsToday: ${error.message}`)
  return count ?? 0
}

async function fetchReconfirmationCampaignIds(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('mode', 'reconfirmation')
  if (error) throw new Error(`getReconfirmationSendsToday: ${error.message}`)
  return (data ?? []).map((r) => r.id as string)
}

// LIMITATION: anchored on the SERVER's local timezone rather than the
// tenant's `tenantTimezone` (WAQ-010 pacing config). The 50/day cap is
// documented per-tenant per-day, so a tenant in HKT whose day rolls over at
// 00:00 HKT may see the counter reset slightly off if the server runs in UTC.
// Threading tenantTimezone here would touch reconfirmation-queries +
// check-reconfirmation-eligibility + the campaign-settings repo + several
// tests (>3 files), so it's deferred per the WONB-008 review fix policy.
// Follow-up logged in `docs/tasks/wonb-008-followups.md`.
function todayStart(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
}

// Re-export the sample helper from its own file so existing import sites can
// keep using the `reconfirmation-queries` path (the tests import from here).
export {
  findReconfirmationAudienceSample,
  type ReconfirmationAudienceSampleRow,
} from './reconfirmation-audience-sample'
