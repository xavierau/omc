// WAQ-007 cooldown-gate inputs against `whatsapp_messages`. Extracted from
// `whatsapp-message-repository.ts` so the writer-of-record file stays under
// the file-size limit. The named exports here are re-bound into the
// `whatsappMessageRepository` const-lock so the domain port surface remains
// unchanged.

import { createServerSupabaseClient } from '../client'

// Counts only successful sends (sent/delivered/read) — Meta's per-business
// cap is by accepted-by-WhatsApp, not attempts. Failed rows don't burn budget.
const COUNTED_STATUSES = ['sent', 'delivered', 'read'] as const

function twentyFourHoursAgoIso(): string {
  return new Date(Date.now() - 24 * 3600_000).toISOString()
}

export async function countMarketingSendsLast24h(args: {
  restaurantId: string
  phoneE164: string
}): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
    .eq('category', 'marketing')
    .in('status', COUNTED_STATUSES as unknown as string[])
    .gt('sent_at', twentyFourHoursAgoIso())
  if (error) throw new Error(`countMarketingSendsLast24h: ${error.message}`)
  return count ?? 0
}

/**
 * Bulk variant for the campaign batch path: ONE round-trip for the whole
 * batch instead of N individual `countMarketingSendsLast24h` calls. Returns
 * a Map keyed by phone_e164 → send count. Phones with zero sends are
 * intentionally absent so callers default to 0 without a null branch.
 *
 * Mirrors the WAQ-004 `findActiveMarketingConsentForPhones` pattern: a single
 * `IN` query, group-by-phone in JS. The `idx_wa_messages_restaurant_sent_at`
 * partial index covers the (restaurant_id, sent_at) leg of the WHERE.
 */
export async function countMarketingSendsLast24hForPhones(args: {
  restaurantId: string
  phones: string[]
}): Promise<Map<string, number>> {
  if (args.phones.length === 0) return new Map()
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('phone_e164')
    .eq('restaurant_id', args.restaurantId)
    .eq('category', 'marketing')
    .in('phone_e164', args.phones)
    .in('status', COUNTED_STATUSES as unknown as string[])
    .gt('sent_at', twentyFourHoursAgoIso())
  if (error) {
    throw new Error(`countMarketingSendsLast24hForPhones: ${error.message}`)
  }
  return tallyByPhone((data ?? []) as Array<{ phone_e164: string }>)
}

function tallyByPhone(
  rows: Array<{ phone_e164: string }>
): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    out.set(r.phone_e164, (out.get(r.phone_e164) ?? 0) + 1)
  }
  return out
}
