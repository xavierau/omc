import type { IntegrationEvent } from '../entities/integration-event'

/**
 * Publishes an `integration_events` outbox row. The real adapter
 * (`emitIntegrationEvent`, WI-6) inserts into Postgres, whose AFTER INSERT
 * trigger (migration 071) fans out one `integration_deliveries` row per
 * subscribed integration. The seam (`createOrGetMember`) is the only caller
 * that constructs `member.created` events directly; everything else is
 * produced by DB triggers.
 */
export interface IntegrationEventPublisher {
  publish(event: IntegrationEvent): Promise<void>
}
