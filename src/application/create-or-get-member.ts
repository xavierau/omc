// INT-001 T-H6: the single member-creation seam. This is the only
// application entry that creates a member -- WhatsApp join, web QR join,
// CSV import, and the partner API all route through this function (WI-7
// rewires the first three; the partner API job processor, WI-3, is the
// fourth caller from day one). It calls `insertMember()`
// (src/infrastructure/supabase/repositories/member-create-repository.ts),
// the only `.from('members').insert(` in src/, and publishes `member.created`
// on a `created` outcome only. Each legacy caller keeps its own
// post-create behaviour (WhatsApp welcome, web coupon, import consent) --
// this seam does not touch consent or welcome sends.

import { randomUUID } from 'node:crypto'
import type { E164Phone } from '@/domain/value-objects/e164-phone'
import type { IntegrationEventPublisher } from '@/domain/ports/integration-event-publisher'
import { insertMember } from '@/infrastructure/supabase/repositories/member-create-repository'
import { getIntegrationEventPublisher } from '@/application/emit-integration-event'

export interface CreateOrGetMemberInput {
  restaurantId: string
  phoneE164: E164Phone
  name: string | null
  preferredLanguage: string | null
  source: string
  /** Present only when the create came from the partner API (WI-3). */
  originIntegrationId?: string | null
}

export interface CreateOrGetMemberResult {
  outcome: 'created' | 'existing'
  memberId: string
  status: 'active' | 'unsubscribed'
}

export interface CreateOrGetMemberDeps {
  publisher?: IntegrationEventPublisher
}

export async function createOrGetMember(
  input: CreateOrGetMemberInput,
  deps: CreateOrGetMemberDeps = {}
): Promise<CreateOrGetMemberResult> {
  // WI-6: was a `noopPublisher` until the real `emitIntegrationEvent`
  // adapter existed -- this is the ONE line WI-1 flagged as WI-6's to
  // change. Deferred to call time (not a module-level default) so it never
  // constructs the real adapter's dependency chain when a test injects its
  // own `deps.publisher`.
  const publisher = deps.publisher ?? getIntegrationEventPublisher()

  const result = await insertMember({
    restaurantId: input.restaurantId,
    phoneE164: input.phoneE164.value,
    name: input.name,
    preferredLanguage: input.preferredLanguage,
  })

  if (result.outcome === 'created') {
    await publisher.publish({
      id: `evt_${randomUUID()}`,
      restaurantId: input.restaurantId,
      memberId: result.memberId,
      type: 'member.created',
      changed: [],
      originIntegrationId: input.originIntegrationId ?? null,
      occurredAt: new Date().toISOString(),
      // WI-6: threaded through so `build-outbound-payload.ts` can populate
      // the outbound wire payload's required `data.source` field (see
      // integration-event.ts's `source` doc comment for why this couldn't
      // wait for a later WI -- migration 071 provisioned the column, but
      // WI-1's seam never wrote to it).
      source: input.source,
    })
  }

  return result
}
