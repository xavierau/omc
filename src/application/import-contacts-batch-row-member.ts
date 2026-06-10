// WONB-004: member-resolution leg of the per-row inserter (kept separate to
// honour the file-LoC and 1-responsibility-per-file rules). Returns either
// the resolved memberId or a typed row-level reject for the orchestrator.

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { loyaltyToken } from '@/domain/value-objects/loyalty-token'
import type { ImportRowRejectReason } from '@/domain/services/__errors__/import-errors'

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>

export interface ResolveMemberInput {
  restaurantId: string
  mergeExistingMembers: boolean
  row: { phoneE164: string; name: string | null; preferredLanguage: 'en' | 'zh_hk' | null }
}

export type ResolveMemberOutcome =
  | { ok: true; id: string | null; created: boolean }
  | { ok: false; reject: { phoneE164: string; reason: ImportRowRejectReason; message?: string } }

export async function resolveMemberId(
  input: ResolveMemberInput
): Promise<ResolveMemberOutcome> {
  const supabase = createServerSupabaseClient()
  if (input.mergeExistingMembers) {
    const existing = await findMemberId(supabase, input.restaurantId, input.row.phoneE164)
    if (existing) return { ok: true, id: existing, created: false }
  }
  const inserted = await tryInsertMember(supabase, input)
  if (inserted.ok) return { ok: true, id: inserted.id, created: true }
  const reason: ImportRowRejectReason =
    inserted.code === '23505' ? 'phone_already_member' : 'duplicate_active'
  return {
    ok: false,
    reject: { phoneE164: input.row.phoneE164, reason, message: inserted.message },
  }
}

async function findMemberId(
  supabase: SupabaseClient,
  restaurantId: string,
  phone: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('members')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('phone', phone)
    .maybeSingle()
  if (error) return null
  return (data as { id: string } | null)?.id ?? null
}

async function tryInsertMember(
  supabase: SupabaseClient,
  input: ResolveMemberInput
): Promise<{ ok: true; id: string } | { ok: false; code?: string; message: string }> {
  const { data, error } = await supabase
    .from('members')
    .insert({
      restaurant_id: input.restaurantId,
      phone: input.row.phoneE164,
      name: input.row.name,
      status: 'active',
      preferred_language: input.row.preferredLanguage,
      loyalty_token: loyaltyToken(),
    })
    .select('id')
    .single()
  if (!error && data) return { ok: true, id: (data as { id: string }).id }
  return {
    ok: false,
    code: (error as { code?: string } | null)?.code,
    message: error?.message ?? 'unknown insert error',
  }
}
