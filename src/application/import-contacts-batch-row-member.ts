// WONB-004: member-resolution leg of the per-row inserter (kept separate to
// honour the file-LoC and 1-responsibility-per-file rules). Returns either
// the resolved memberId or a typed row-level reject for the orchestrator.
//
// INT-001 T-H6 (WI-7): member creation routes through the single seam
// (createOrGetMember) so member.created fans out to enabled integrations
// with source:'csv_import'. The seam always resolves a 23505 conflict to
// outcome:'existing' rather than an insert failure -- this file's own
// mergeExistingMembers business rule (reject a duplicate phone when NOT
// merging) is layered on top of the seam's result, not inside it: the seam
// only owns "did the row get created", never "is a duplicate acceptable
// here".

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import type { ImportRowRejectReason } from '@/domain/services/__errors__/import-errors'
import { createOrGetMember } from './create-or-get-member'
import { resolveLegacyMemberE164 } from './resolve-legacy-member-e164'

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>

export interface ResolveMemberInput {
  restaurantId: string
  mergeExistingMembers: boolean
  row: { phoneE164: string; name: string | null; preferredLanguage: 'en' | 'zh_hk' | null }
}

export type ResolveMemberOutcome =
  | { ok: true; id: string | null; created: boolean }
  | { ok: false; reject: { phoneE164: string; reason: ImportRowRejectReason; message?: string } }

// The exact string member-create-repository.ts (WI-1, frozen) throws when a
// 23505 insert conflict's re-select finds no row -- the only shape that
// signals "this was a unique-violation conflict" rather than an unrelated
// DB failure, since the seam otherwise resolves a genuine conflict to
// outcome:'existing' (handled separately below) rather than throwing.
const RESELECT_MISS_MARKER = 'unique violation on insert'

export async function resolveMemberId(
  input: ResolveMemberInput
): Promise<ResolveMemberOutcome> {
  const supabase = createServerSupabaseClient()
  if (input.mergeExistingMembers) {
    const existing = await findMemberId(supabase, input.restaurantId, input.row.phoneE164)
    if (existing) return { ok: true, id: existing, created: false }
  }
  return createViaSeam(input)
}

async function createViaSeam(input: ResolveMemberInput): Promise<ResolveMemberOutcome> {
  // N-8 (WI-17 confirmation review, G-3 gap 1): `input.row.phoneE164` is
  // `PhoneNumber.create(raw).value` (import-contacts-batch-validation.ts) --
  // the SAME legacy, non-strict grammar register-member.ts/register-member-web.ts
  // accept (dots, leading-zero runs, etc.), not already a valid E.164. A
  // bare `E164Phone.of` here used to throw for any legacy-accepted format
  // this validator waved through, land in the catch below, and get
  // misclassified as `duplicate_active` -- the row was silently rejected as
  // a duplicate when it was never imported at all. Resolved via the SAME
  // strict-then-fallback rule the other two member-creation paths use, in
  // its OWN try/catch so a genuine parse failure (reason: `invalid_phone`)
  // can never be confused with a DB/seam conflict (reason:
  // `phone_already_member` / `duplicate_active`, below).
  let phoneE164
  try {
    phoneE164 = resolveLegacyMemberE164(PhoneNumber.create(input.row.phoneE164))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return reject(input.row.phoneE164, 'invalid_phone', message)
  }

  try {
    const result = await createOrGetMember({
      restaurantId: input.restaurantId,
      phoneE164,
      name: input.row.name,
      preferredLanguage: input.row.preferredLanguage,
      source: 'csv_import',
    })
    if (result.outcome === 'created') {
      return { ok: true, id: result.memberId, created: true }
    }
    // outcome === 'existing': acceptable only when merging; otherwise this
    // row is a duplicate the import must reject, matching the pre-seam
    // behaviour of tryInsertMember's 23505 -> phone_already_member mapping.
    if (input.mergeExistingMembers) {
      return { ok: true, id: result.memberId, created: false }
    }
    return reject(input.row.phoneE164, 'phone_already_member')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const reason: ImportRowRejectReason = message.includes(RESELECT_MISS_MARKER)
      ? 'phone_already_member'
      : 'duplicate_active'
    return reject(input.row.phoneE164, reason, message)
  }
}

function reject(
  phoneE164: string,
  reason: ImportRowRejectReason,
  message?: string
): ResolveMemberOutcome {
  return { ok: false, reject: { phoneE164, reason, message } }
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
