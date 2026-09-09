// INT-001: durable (member, integration) -> external_ref link. Called by
// the member-create job (WI-3) after a successful `createOrGetMember`, so a
// second partner_api create for the same external_ref resolves to the same
// member. Upserting `external_ref` (rather than only inserting) also fires
// the `member_ref_outbox` trigger (migration 071) on a genuine rename.

import { createServerSupabaseClient } from '../client'

export interface UpsertIntegrationMemberRefArgs {
  memberId: string
  integrationId: string
  externalRef: string
}

export async function upsertIntegrationMemberRef(
  args: UpsertIntegrationMemberRefArgs
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('integration_member_refs')
    .upsert(
      {
        member_id: args.memberId,
        integration_id: args.integrationId,
        external_ref: args.externalRef,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'member_id,integration_id' }
    )
  if (error) throw new Error(`upsertIntegrationMemberRef: ${error.message}`)
}

export async function findMemberIdByExternalRef(args: {
  integrationId: string
  externalRef: string
}): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_member_refs')
    .select('member_id')
    .eq('integration_id', args.integrationId)
    .eq('external_ref', args.externalRef)
    .maybeSingle()
  if (error) throw new Error(`findMemberIdByExternalRef: ${error.message}`)
  return (data as { member_id: string } | null)?.member_id ?? null
}

/** WI-6: the reverse lookup, for `build-outbound-payload.ts`'s
 * `external_ref` field -- given a member (already resolved from the
 * event/delivery row), what ref (if any) THIS integration attached to
 * them. */
export async function findExternalRefForMember(args: {
  memberId: string
  integrationId: string
}): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_member_refs')
    .select('external_ref')
    .eq('member_id', args.memberId)
    .eq('integration_id', args.integrationId)
    .maybeSingle()
  if (error) throw new Error(`findExternalRefForMember: ${error.message}`)
  return (data as { external_ref: string } | null)?.external_ref ?? null
}
