// INT-001 WI-13: manual-recovery code path for the per-integration inbound
// depth counter (`int001:depth:{integrationId}`). The 5-minute maintenance
// sweep (sweep-integration-queues.ts) already reconciles every integration
// automatically -- use this script only when you need to correct ONE
// integration immediately rather than wait for the next tick (see
// `docs/integrations/member-api-ops.md` §7).
//
// Reads Postgres (`integration_member_jobs WHERE status IN
// ('queued','processing')`) as the source of truth and writes the Redis
// counter ONLY if it disagrees -- safe to run at any time, including when
// nothing is wrong (it will report "already correct, no change made").
//
// Usage:
//   npx tsx scripts/ops/reconcile-integration-depth.ts <integrationId>

import { reconcileIntegrationDepthCounter } from '@/application/reconcile-integration-depth-counters'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'

async function main(): Promise<void> {
  const integrationId = process.argv[2]
  if (!integrationId) {
    console.error('Usage: npx tsx scripts/ops/reconcile-integration-depth.ts <integrationId>')
    process.exit(1)
  }

  const correction = await reconcileIntegrationDepthCounter(integrationId, getInboundRateLimiter())

  if (!correction) {
    console.log(`int001:depth:${integrationId} already matches Postgres truth -- no change made.`)
    return
  }

  console.log(
    `int001:depth:${integrationId} corrected: ${correction.previousCount} -> ${correction.truthCount}`
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('reconcile-integration-depth failed:', err)
    process.exit(1)
  })
