import type { Worker } from 'bullmq'
import {
  ensureWorkerStarted as startCampaignWorker,
  getWorker as getCampaignWorker,
} from '@/infrastructure/queue/campaign-queue'
import {
  ensureWorkerStarted as startEventDispatchWorker,
  getWorker as getEventDispatchWorker,
} from '@/infrastructure/queue/event-dispatch-queue'
import {
  ensureWorkerStarted as startReceiptWorker,
  getWorker as getReceiptWorker,
} from '@/infrastructure/queue/receipt-queue'

function startAll(): void {
  startCampaignWorker()
  startEventDispatchWorker()
  startReceiptWorker()
  console.log('Workers started: campaign, event-dispatch, receipt')
}

function activeWorkers(): Worker[] {
  return [getCampaignWorker(), getEventDispatchWorker(), getReceiptWorker()]
    .filter((w): w is Worker => w !== null)
}

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Workers shutting down (draining active jobs) on ${signal}...`)
  try {
    await Promise.all(activeWorkers().map((w) => w.close()))
    console.log('Workers shut down cleanly')
    process.exit(0)
  } catch (err) {
    console.error('Worker shutdown error:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

function installShutdownHandlers(): void {
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })
}

startAll()
installShutdownHandlers()
// Workers keep the event loop alive; do not call process.exit here.
