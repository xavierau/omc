// WONB-008 Stream C: phone+capturedAt projection for the preflight dialog
// audience preview. Separate from `findReconfirmationAudience` (which returns
// memberId/preferred_language for actual sends) because the dialog must NOT
// leak member ids or names — only a phone + capture date.

import { createServerSupabaseClient } from '../client'

export interface ReconfirmationAudienceSampleRow {
  phoneE164: string
  capturedAt: string
}

interface SampleArgs {
  restaurantId: string
  limit: number
}

interface SampleMemberEmbed {
  phone_e164: string
  restaurant_id: string
}

interface SampleJoinedRow {
  captured_at: string
  members: SampleMemberEmbed | SampleMemberEmbed[] | null
}

export async function findReconfirmationAudienceSample(
  args: SampleArgs
): Promise<ReconfirmationAudienceSampleRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .select('captured_at, members:member_id(phone_e164, restaurant_id)')
    .eq('restaurant_id', args.restaurantId)
    .eq('category', 'marketing')
    .eq('status', 'opted_in')
    .eq('consent_grade', 'weak')
    .order('captured_at', { ascending: false })
    .limit(args.limit)
  if (error) throw new Error(`findReconfirmationAudienceSample: ${error.message}`)
  return mapSampleRows(
    (data ?? []) as unknown as SampleJoinedRow[],
    args.restaurantId
  )
}

// Defence-in-depth: project members.restaurant_id alongside the phone and
// post-filter rows where the join produced a cross-tenant member. Should
// never happen given the consent_records.restaurant_id eq above, but a
// corrupted DB state shouldn't be able to leak another tenant's phone into
// the preflight dialog preview.
function mapSampleRows(
  rows: SampleJoinedRow[],
  restaurantId: string
): ReconfirmationAudienceSampleRow[] {
  const out: ReconfirmationAudienceSampleRow[] = []
  for (const r of rows) {
    const m = pickSampleMember(r.members)
    if (!m) continue
    if (m.restaurant_id !== restaurantId) {
      console.warn('[reconfirmation] cross-tenant member skipped', {
        memberRestaurantId: m.restaurant_id,
        requestedRestaurantId: restaurantId,
      })
      continue
    }
    out.push({ phoneE164: m.phone_e164, capturedAt: r.captured_at })
  }
  return out
}

function pickSampleMember(
  embed: SampleJoinedRow['members']
): SampleMemberEmbed | null {
  if (!embed) return null
  if (Array.isArray(embed)) return embed[0] ?? null
  return embed
}
