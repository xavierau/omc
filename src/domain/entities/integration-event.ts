// INT-001: one row of the `integration_events` outbox. `member.created` is
// inserted by the create-or-get-member seam (fast path); `member.updated` is
// produced entirely by DB triggers (see migration 071) and is never
// constructed by application code directly.

export type IntegrationEventType = 'member.created' | 'member.updated' | 'ping'

export interface IntegrationEvent {
  id: string
  restaurantId: string
  memberId: string | null
  type: IntegrationEventType
  changed: string[]
  originIntegrationId: string | null
  occurredAt: string
  /**
   * INT-001 WI-6: which creation path produced this event (`whatsapp` |
   * `web` | `csv_import` | `partner_api`), stored in `integration_events
   * .source` (migration 071 -- provisioned by WI-1 but never written until
   * now). Set by the seam at `member.created` emit time from the caller's
   * own `CreateOrGetMemberInput.source`; DB-trigger-produced `member
   * .updated` rows never set it (a SQL trigger has no notion of "how the
   * member originally joined") -- `build-outbound-payload.ts` falls back to
   * the same member's `member.created` event when this is null. Additive
   * field: existing WI-1 callers that don't set it keep compiling only if
   * they already pass every other field, so this is intentionally
   * `string | null` rather than required.
   */
  source: string | null
}
