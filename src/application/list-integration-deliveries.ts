// INT-001 WI-8 US-9: `GET /api/dashboard/pos-integrations/[id]/deliveries`
// -- the delivery log table. WI-6 didn't build a general cursor-paginated
// list query (it only needed relay/resume/prune-shaped reads), so this is
// a new read path over `integration_deliveries` joined (by ONE batched
// `.in()` query, never per-row) to `integration_events` for the display
// fields US-9 names: event type, event id, occurred_at, attempts, status,
// last HTTP code, next retry at.

import {
  findDeliveriesForIntegration,
  type DeliveryListRow,
} from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { findIntegrationEventsByIds } from '@/infrastructure/supabase/repositories/integration-event-repository'
import type { IntegrationDeliveryStatus } from '@/domain/entities/integration-delivery'
import type { IntegrationEventType } from '@/domain/entities/integration-event'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 500

export interface IntegrationDeliveryListItem {
  id: string
  eventId: string
  eventType: IntegrationEventType | null
  occurredAt: string | null
  status: IntegrationDeliveryStatus
  attempts: number
  lastHttpStatus: number | null
  lastErrorCode: string | null
  nextRetryAt: string | null
  createdAt: string
}

export interface ListIntegrationDeliveriesResult {
  data: IntegrationDeliveryListItem[]
  nextCursor: string | null
}

export interface ListIntegrationDeliveriesArgs {
  status?: IntegrationDeliveryStatus
  cursor?: string
  limit?: number
}

export async function listIntegrationDeliveries(
  integrationId: string,
  restaurantId: string,
  args: ListIntegrationDeliveriesArgs = {}
): Promise<ListIntegrationDeliveriesResult> {
  const limit = Math.min(args.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)

  const rows: DeliveryListRow[] = await findDeliveriesForIntegration(integrationId, restaurantId, {
    status: args.status,
    cursor: args.cursor,
    limit,
  })

  const eventIds = [...new Set(rows.map((row) => row.eventId))]
  const events = await findIntegrationEventsByIds(eventIds)
  const eventById = new Map(events.map((event) => [event.id, event]))

  const data: IntegrationDeliveryListItem[] = rows.map((row) => {
    const event = eventById.get(row.eventId) ?? null
    return {
      id: row.id,
      eventId: row.eventId,
      eventType: event?.type ?? null,
      occurredAt: event?.occurredAt ?? null,
      status: row.status,
      attempts: row.attempts,
      lastHttpStatus: row.lastHttpStatus,
      lastErrorCode: row.lastErrorCode,
      nextRetryAt: row.nextRetryAt,
      createdAt: row.createdAt,
    }
  })

  const nextCursor = rows.length === limit ? rows[rows.length - 1].createdAt : null

  return { data, nextCursor }
}
