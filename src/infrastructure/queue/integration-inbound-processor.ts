// INT-001 WI-3: dispatches an `integration-inbound` job by `job.name`.
// `member-create` is fully implemented here (WI-3's own worker logic lives
// in `process-member-create-job.ts`). `welcome-send` is a deliberate STUB:
// WI-3 enqueues `welcome-send` jobs (plan §"Member-create job (worker)"
// step 6) so a partner sees `welcome_outcome: 'queued'` immediately, but
// WI-4 owns the real send-time re-check + mint + send
// (`process-welcome-send-job.ts`, not yet built). Resolving the stub as a
// no-op success (rather than throwing) means these jobs sit harmlessly in
// BullMQ's completed set until WI-4 replaces this case with the real call
// -- never dead-lettered, never retried into a Slack alert for work nobody
// has written yet. WI-4's own file list says it will "modify
// integration-inbound-processor.ts (dispatch by job name)" -- this file
// already does that; WI-4 replaces the body of the `welcome-send` case.

import type { Job } from 'bullmq'
import { processMemberCreateJob } from '@/application/process-member-create-job'
import type { MemberCreateJobData, WelcomeSendJobData } from './integration-inbound-queue'

export async function integrationInboundProcessor(
  job: Job<MemberCreateJobData | WelcomeSendJobData>
): Promise<void> {
  switch (job.name) {
    case 'member-create':
      await processMemberCreateJob(job.data as MemberCreateJobData, job.attemptsMade + 1)
      return
    case 'welcome-send':
      // Stub -- see header. WI-4 replaces this with a real call to
      // process-welcome-send-job.ts.
      console.log('[IntegrationInboundProcessor] welcome-send stub (WI-4 not yet landed)', {
        jobId: job.id,
      })
      return
    default:
      console.error('[IntegrationInboundProcessor] unknown job name', { name: job.name, jobId: job.id })
  }
}
