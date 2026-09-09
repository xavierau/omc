// INT-001 WI-3/WI-4: dispatches an `integration-inbound` job by `job.name`.
// `member-create` is WI-3's own worker logic (`process-member-create-job.ts`).
// `welcome-send` is WI-4's send-time re-check + idempotent mint + send
// (`process-welcome-send-job.ts`) -- WI-3 enqueues these jobs but left this
// case a no-op stub; WI-4 replaces it with the real call below.

import type { Job } from 'bullmq'
import { processMemberCreateJob } from '@/application/process-member-create-job'
import { processWelcomeSendJob } from '@/application/process-welcome-send-job'
import type { MemberCreateJobData, WelcomeSendJobData } from './integration-inbound-queue'

export async function integrationInboundProcessor(
  job: Job<MemberCreateJobData | WelcomeSendJobData>
): Promise<void> {
  switch (job.name) {
    case 'member-create':
      await processMemberCreateJob(job.data as MemberCreateJobData, job.attemptsMade + 1)
      return
    case 'welcome-send':
      await processWelcomeSendJob(job.data as WelcomeSendJobData, job.attemptsMade + 1)
      return
    default:
      console.error('[IntegrationInboundProcessor] unknown job name', { name: job.name, jobId: job.id })
  }
}
