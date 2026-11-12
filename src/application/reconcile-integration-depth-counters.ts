// INT-001 WI-13 (Gap B): per-integration inbound depth-counter
// reconciliation. `int001:depth:{integrationId}` (Redis) is only ever
// incremented at enqueue and decremented at job-terminal-state
// (enqueue-member-create.ts, process-member-create-job.ts) -- a crashed or
// lost job between those two points permanently inflates the counter, and
// nothing corrected it (WI-11's ops playbook §7 -- now closed by this
// file). The plan's own architecture text names the fix: "the 5-min
// sweeper re-derives every counter from `integration_member_jobs WHERE
// status IN ('queued','processing')` (a counter is a cache, the table is
// truth)". Postgres is that truth -- not BullMQ's own waiting/active/delayed
// counts, which have no per-integration index and would also mix in
// `welcome-send` jobs, which never touch this counter at all.
//
// Wired into the existing 5-min maintenance sweep
// (sweep-integration-queues.ts's runMaintenanceSweep). Also exported
// standalone (reconcileIntegrationDepthCounter) as the manual-recovery code
// path the ops playbook previously described as a raw SQL query + a
// `redis-cli SET` command.

import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import {
  countNonTerminalJobsByIntegration,
  countNonTerminalJobsForIntegration,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'

function depthCounterKey(integrationId: string): string {
  return `int001:depth:${integrationId}`
}

export interface DepthCounterCorrection {
  integrationId: string
  previousCount: number
  truthCount: number
}

/** Bound on how many integrations' counters one sweep tick rebuilds --
 * matches sweep-integration-queues.ts's own bounded-work-per-run discipline
 * (RELAY_BATCH_LIMIT). The plan's own scale note (~20 integrations) is well
 * inside this; a run that hits the bound picks up the remainder on the
 * next 5-min tick rather than blocking. */
export const DEPTH_RECONCILE_BATCH_LIMIT = 200

async function reconcileOne(
  rateLimiter: RateLimiterPort,
  integrationId: string,
  truthCount: number
): Promise<DepthCounterCorrection | null> {
  try {
    const key = depthCounterKey(integrationId)
    const previousCount = await rateLimiter.get(key)
    if (previousCount === truthCount) return null
    await rateLimiter.set(key, truthCount)
    console.warn('[reconcileIntegrationDepthCounters] corrected drift', {
      integrationId,
      previousCount,
      truthCount,
    })
    return { integrationId, previousCount, truthCount }
  } catch (err) {
    console.warn('[reconcileIntegrationDepthCounters] reconcile failed for one integration', {
      integrationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/** Reconciles every integration with at least one non-terminal
 * (queued/processing) member-create job. Idempotent: re-running with no
 * drift performs zero Redis writes ("no drift -> no write"). Corrects
 * drift in BOTH directions -- a counter left too HIGH by a crashed job, or
 * too LOW/missing after a Redis flush lost the reservations. Never throws:
 * a Postgres/Redis hiccup on one integration (or on the truth query itself)
 * must not block the rest of the 5-min maintenance sweep. */
export async function reconcileAllIntegrationDepthCounters(
  rateLimiter: RateLimiterPort
): Promise<DepthCounterCorrection[]> {
  let truths: { integrationId: string; count: number }[]
  try {
    truths = await countNonTerminalJobsByIntegration()
  } catch (err) {
    console.warn('[reconcileIntegrationDepthCounters] countNonTerminalJobsByIntegration failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  const corrections: DepthCounterCorrection[] = []
  for (const { integrationId, count: truthCount } of truths.slice(0, DEPTH_RECONCILE_BATCH_LIMIT)) {
    const correction = await reconcileOne(rateLimiter, integrationId, truthCount)
    if (correction) corrections.push(correction)
  }
  return corrections
}

/** Single-integration manual-recovery code path -- replaces the ops
 * playbook's raw `SELECT count(*) ...` + `redis-cli SET` recipe with a
 * callable function. Safe to call any time: reads Postgres, writes Redis
 * ONLY if they disagree, and reports what (if anything) changed. */
export async function reconcileIntegrationDepthCounter(
  integrationId: string,
  rateLimiter: RateLimiterPort
): Promise<DepthCounterCorrection | null> {
  const truthCount = await countNonTerminalJobsForIntegration(integrationId)
  return reconcileOne(rateLimiter, integrationId, truthCount)
}
