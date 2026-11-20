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
import {
  ensureWorkerStarted as startEmailWorker,
  getWorker as getEmailWorker,
} from '@/infrastructure/queue/email-queue'
import {
  ensureWorkerStarted as startIntegrationInboundWorker,
  getWorker as getIntegrationInboundWorker,
} from '@/infrastructure/queue/integration-inbound-queue'
import {
  ensureWorkerStarted as startIntegrationOutboundWorker,
  getWorker as getIntegrationOutboundWorker,
} from '@/infrastructure/queue/integration-outbound-processor'
import {
  ensureWorkerStarted as startAgentReplyWorker,
  ensureAgentRetentionScheduler,
  getWorker as getAgentReplyWorker,
} from '@/infrastructure/queue/agent-reply-queue'
import { agentReplyWorkerHandlers } from '@/app/api/webhooks/whatsapp/agent-handler'

function startAll(): void {
  startCampaignWorker()
  startEventDispatchWorker()
  startReceiptWorker()
  startEmailWorker()
  startIntegrationInboundWorker()
  startIntegrationOutboundWorker()
  startAgentReplyWorker(agentReplyWorkerHandlers())
  // AGENT-001 R5: hourly retention purge. A Redis hiccup here must not kill the other workers.
  ensureAgentRetentionScheduler().catch((err) => {
    console.error('[AgentReplyQueue] retention scheduler not registered:', err instanceof Error ? err.name : err)
  })
  console.log('Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply')
}

function activeWorkers(): Worker[] {
  return [
    getCampaignWorker(),
    getEventDispatchWorker(),
    getReceiptWorker(),
    getEmailWorker(),
    getIntegrationInboundWorker(),
    getIntegrationOutboundWorker(),
    getAgentReplyWorker(),
  ].filter((w): w is Worker => w !== null)
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
