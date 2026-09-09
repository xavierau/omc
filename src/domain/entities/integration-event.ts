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
}
