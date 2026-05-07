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

interface SampleJoinedRow {
  captured_at: string
  members:
    | { phone_e164: string }
    | Array<{ phone_e164: string }>
    | null
}

export async function findReconfirmationAudienceSample(
  args: SampleArgs
): Promise<ReconfirmationAudienceSampleRow[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .select('captured_at, members:member_id(phone_e164)')
    .eq('restaurant_id', args.restaurantId)
    .eq('category', 'marketing')
    .eq('status', 'opted_in')
    .eq('consent_grade', 'weak')
    .order('captured_at', { ascending: false })
    .limit(args.limit)
  if (error) throw new Error(`findReconfirmationAudienceSample: ${error.message}`)
  return mapSampleRows((data ?? []) as unknown as SampleJoinedRow[])
}

function mapSampleRows(
  rows: SampleJoinedRow[]
): ReconfirmationAudienceSampleRow[] {
  const out: ReconfirmationAudienceSampleRow[] = []
  for (const r of rows) {
    const phone = pickSamplePhone(r.members)
    if (!phone) continue
    out.push({ phoneE164: phone, capturedAt: r.captured_at })
  }
  return out
}

function pickSamplePhone(
  embed: SampleJoinedRow['members']
): string | null {
  if (!embed) return null
  if (Array.isArray(embed)) return embed[0]?.phone_e164 ?? null
  return embed.phone_e164 ?? null
}
