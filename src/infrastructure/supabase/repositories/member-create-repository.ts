// INT-001 T-H6: the SOLE `.from('members').insert(` in src/. Every
// member-creation path in the app (WhatsApp join, web QR join, CSV import,
// partner API) routes through `createOrGetMember`
// (src/application/create-or-get-member.ts), which calls only this file.
// A boundary test (WI-7, src/__tests__/members-insert-boundary.test.ts)
// greps `src/` for `.from('members')` followed by `.insert(` and asserts
// exactly one hit -- this file.
//
// `idx_members_restaurant_phone` (a unique index on (restaurant_id, phone))
// is treated as "existing", never as a failure: on 23505 we re-select rather
// than throwing, which is what makes concurrent double-create resolve to
// exactly one row with one 'created' and one 'existing' outcome.

import { createServerSupabaseClient } from '../client'

export interface InsertMemberArgs {
  restaurantId: string
  phoneE164: string
  name: string | null
  preferredLanguage: string | null
}

export interface InsertMemberResult {
  outcome: 'created' | 'existing'
  memberId: string
  status: 'active' | 'unsubscribed'
}

interface MemberRow {
  id: string
  status: 'active' | 'unsubscribed'
}

export async function insertMember(
  args: InsertMemberArgs
): Promise<InsertMemberResult> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .insert({
      restaurant_id: args.restaurantId,
      phone: args.phoneE164,
      name: args.name,
      preferred_language: args.preferredLanguage,
    })
    .select('id, status')
    .single()

  if (!error) {
    const row = data as MemberRow | null
    if (!row) throw new Error('insertMember: insert succeeded but returned no row')
    return { outcome: 'created', memberId: row.id, status: row.status }
  }

  if ((error as { code?: string }).code !== '23505') {
    throw new Error(`insertMember: ${error.message}`)
  }

  // OD-2(b): the existing branch must never reactivate an unsubscribed
  // member -- and it doesn't, because it only reads the row, it never
  // writes to it.
  const existing = await selectMemberByPhone(args.restaurantId, args.phoneE164)
  if (!existing) {
    // The row that caused the 23505 is gone by the time we re-select
    // (deleted between the failed insert and this read) -- surface as a
    // transient error so the caller retries rather than silently dropping
    // the create.
    throw new Error(
      'insertMember: unique violation on insert but no row found on re-select'
    )
  }
  return { outcome: 'existing', memberId: existing.id, status: existing.status }
}

async function selectMemberByPhone(
  restaurantId: string,
  phone: string
): Promise<MemberRow | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select('id, status')
    .eq('restaurant_id', restaurantId)
    .eq('phone', phone)
    .maybeSingle()
  if (error) throw new Error(`insertMember (re-select): ${error.message}`)
  return data as MemberRow | null
}
