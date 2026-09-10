// INT-001 WI-6: the 30s relay + 5min maintenance sweep, run as two
// `sweep` job-scheduler entries in the outbound worker
// (`integration-outbound-processor.ts`).
//
// Relay (30s): `principle_backstop_only_repairs_what_it_selects` -- picks
// up exactly the `queued AND enqueued_at IS NULL` rows the fast path
// (`emit-integration-event.ts`) either never ran for (`member.updated`,
// produced by DB triggers with no application code involved) or failed to
// enqueue for (a Redis hiccup at emit time), OR a resumed-from-`paused`
// row (see resume-outbound.ts). Idempotent on delivery id via
// `addRelayDeliverJob` (`integration-outbound-queue.ts`): re-selecting a
// row whose enqueue is still genuinely in flight is a BullMQ no-op exactly
// like before, but a row whose EARLIER job already reached a terminal
// state (completed-as-paused, or failed) gets that stale job removed
// first, so the re-add actually creates a new one (C-2 -- the plain
// `jobId = deliveryId` dedup used to swallow this second case silently).
//
// Maintenance (5min): delivery-log pruning (US-9: <=500 rows / 30 days per
// integration), `integration_events` orphan pruning, the T-M2 volume
// anomaly check, and (WI-13) the inbound per-integration depth-counter
// rebuild -- WI-6 originally deferred this exact task (flagged as an
// unresolved-ownership gap in its own handoff); it's now closed via
// reconcile-integration-depth-counters.ts, which does the actual Postgres
// read + Redis correction. This file only wires it into the existing tick.

import { findDeliveriesToRelay, listIntegrationIdsWithDeliveries, markEnqueued, pruneDeliveriesForIntegration } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { pruneOrphanIntegrationEvents } from '@/infrastructure/supabase/repositories/integration-event-repository'
import { findIntegrationVolumeAnomalies } from '@/infrastructure/supabase/repositories/integration-anomaly-stats-repository'
import { addRelayDeliverJob } from '@/infrastructure/queue/integration-outbound-queue'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { notifyOpsAlert } from '@/application/notify-ops-alert'
import { reconcileAllIntegrationDepthCounters } from '@/application/reconcile-integration-depth-counters'

const RELAY_MIN_AGE_MS = 5000
const RELAY_BATCH_LIMIT = 200

export async function relayQueuedDeliveries(): Promise<void> {
  const deliveries = await findDeliveriesToRelay({ olderThanMs: RELAY_MIN_AGE_MS, limit: RELAY_BATCH_LIMIT })
  await Promise.all(deliveries.map((delivery) => relayOne(delivery.snapshot.id)))
}

async function relayOne(deliveryId: string): Promise<void> {
  try {
    // C-2: `addRelayDeliverJob` (not the plain `addDeliverJob`) -- a row
    // reaching this selection can be a first-generation enqueue that's
    // still in flight, OR a resume-after-pause whose earlier job already
    // completed under the same BullMQ job id. The relay-specific add
    // checks which case it is before deciding whether to dedupe or
    // re-create (see that function's own header).
    await addRelayDeliverJob(deliveryId)
    await markEnqueued(deliveryId, new Date().toISOString())
  } catch (err) {
    console.warn('[sweepIntegrationQueues] relay enqueue failed, retried next tick', {
      deliveryId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

const DELIVERY_RETENTION_DAYS = 30
const DELIVERY_RETENTION_MAX_ROWS = 500
const EVENT_ORPHAN_RETENTION_DAYS = 30
const ANOMALY_MULTIPLIER = 3
// Floor below which even an "infinite" ratio (e.g. 2 vs a 0 baseline) is
// noise, not a signal -- a judgment call disclosed in the implementation
// note rather than picked silently.
const ANOMALY_MIN_LAST_HOUR_VOLUME = 10

export async function runMaintenanceSweep(): Promise<void> {
  await pruneDeliveryLogs()
  await pruneOrphanEvents()
  await checkVolumeAnomalies()
  await reconcileDepthCounters()
}

async function pruneDeliveryLogs(): Promise<void> {
  let integrationIds: string[]
  try {
    integrationIds = await listIntegrationIdsWithDeliveries()
  } catch (err) {
    console.warn('[sweepIntegrationQueues] listIntegrationIdsWithDeliveries failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }
  for (const integrationId of integrationIds) {
    try {
      await pruneDeliveriesForIntegration(integrationId, DELIVERY_RETENTION_MAX_ROWS, DELIVERY_RETENTION_DAYS)
    } catch (err) {
      console.warn('[sweepIntegrationQueues] pruneDeliveriesForIntegration failed', {
        integrationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function pruneOrphanEvents(): Promise<void> {
  try {
    await pruneOrphanIntegrationEvents(EVENT_ORPHAN_RETENTION_DAYS)
  } catch (err) {
    console.warn('[sweepIntegrationQueues] pruneOrphanIntegrationEvents failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function checkVolumeAnomalies(): Promise<void> {
  let anomalies
  try {
    anomalies = await findIntegrationVolumeAnomalies({
      multiplier: ANOMALY_MULTIPLIER,
      minLastHourVolume: ANOMALY_MIN_LAST_HOUR_VOLUME,
    })
  } catch (err) {
    console.warn('[sweepIntegrationQueues] findIntegrationVolumeAnomalies failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }
  for (const anomaly of anomalies) {
    await notifyOpsAlert({
      kind: 'engineering_alert',
      severity: 'warn',
      restaurantId: anomaly.restaurantId,
      message: `Integration ${anomaly.integrationId} create volume ${anomaly.lastHourCount}/hr, ${(
        anomaly.lastHourCount / Math.max(anomaly.sevenDayHourlyAverage, 0.01)
      ).toFixed(1)}x its 7-day baseline`,
      details: {
        integrationId: anomaly.integrationId,
        lastHourCount: anomaly.lastHourCount,
        sevenDayHourlyAverage: anomaly.sevenDayHourlyAverage,
      },
    })
  }
}

async function reconcileDepthCounters(): Promise<void> {
  try {
    await reconcileAllIntegrationDepthCounters(getInboundRateLimiter())
  } catch (err) {
    console.warn('[sweepIntegrationQueues] reconcileAllIntegrationDepthCounters failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
