import { ensureWorkerStarted as startCampaignWorker } from '@/infrastructure/queue/campaign-queue'
import { ensureWorkerStarted as startEventDispatchWorker } from '@/infrastructure/queue/event-dispatch-queue'
import { ensureWorkerStarted as startReceiptWorker } from '@/infrastructure/queue/receipt-queue'

function startAll(): void {
  startCampaignWorker()
  startEventDispatchWorker()
  startReceiptWorker()
  console.log('Workers started: campaign, event-dispatch, receipt')
}

function installShutdownHandler(): void {
  process.on('SIGTERM', () => {
    console.log('Workers shutting down...')
    process.exit(0)
  })
}

startAll()
installShutdownHandler()
// Workers keep the event loop alive; do not call process.exit here.
