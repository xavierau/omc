// INT-001 WI-6: the 30s relay + 5min maintenance sweep, run as two
// `sweep` job-scheduler entries in the outbound worker
// (`integration-outbound-processor.ts`).
//
// Relay (30s): `principle_backstop_only_repairs_what_it_selects` -- picks
// up exactly the `queued AND enqueued_at IS NULL` rows the fast path
// (`emit-integration-event.ts`) either never ran for (`member.updated`,
// produced by DB triggers with no application code involved) or failed to
// enqueue for (a Redis hiccup at emit time). Idempotent on delivery id: a
// `queue.add` with `jobId = deliveryId` for a row already enqueued is a
// BullMQ no-op, so re-selecting the same row on a double run creates no
// duplicate job.
//
// Maintenance (5min): delivery-log pruning (US-9: <=500 rows / 30 days per
// integration), `integration_events` orphan pruning, and the T-M2 volume
// anomaly check. Deliberately does NOT include the inbound queue-depth
// counter rebuild the plan's prose also assigns to "the 5-min sweeper" --
// that counter (`int001:depth:{integrationId}`) is WI-2/WI-3's own
// Redis key, written by their route/processor; this dispatch's own
// Objective and threat-closure list (T-M2/T-M4/T-M6/T-M8/T-M11/T-H7) name
// only the outbound-side maintenance tasks, and Traceability assigns T-M7
// to WI-2/WI-11, not WI-6. Rebuilding it here risks racing WI-3's
// concurrent, uncommitted work on the very same key. Flagged as a gap for
// the orchestrator to confirm is owned elsewhere.

import { findDeliveriesToRelay, listIntegrationIdsWithDeliveries, markEnqueued, pruneDeliveriesForIntegration } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { pruneOrphanIntegrationEvents } from '@/infrastructure/supabase/repositories/integration-event-repository'
import { findIntegrationVolumeAnomalies } from '@/infrastructure/supabase/repositories/integration-anomaly-stats-repository'
import { addDeliverJob } from '@/infrastructure/queue/integration-outbound-queue'
import { notifyOpsAlert } from '@/application/notify-ops-alert'

const RELAY_MIN_AGE_MS = 5000
const RELAY_BATCH_LIMIT = 200

export async function relayQueuedDeliveries(): Promise<void> {
  const deliveries = await findDeliveriesToRelay({ olderThanMs: RELAY_MIN_AGE_MS, limit: RELAY_BATCH_LIMIT })
  await Promise.all(deliveries.map((delivery) => relayOne(delivery.snapshot.id)))
}

async function relayOne(deliveryId: string): Promise<void> {
  try {
    await addDeliverJob(deliveryId)
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
