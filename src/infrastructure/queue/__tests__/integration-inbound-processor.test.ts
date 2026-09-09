import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/application/process-member-create-job')
vi.mock('@/application/process-welcome-send-job')

import { processMemberCreateJob } from '@/application/process-member-create-job'
import { processWelcomeSendJob } from '@/application/process-welcome-send-job'
import { integrationInboundProcessor } from '../integration-inbound-processor'
import type { MemberCreateJobData, WelcomeSendJobData } from '../integration-inbound-queue'

function job<T>(name: string, data: T, attemptsMade = 0): never {
  return { name, data, attemptsMade } as never
}

describe('integrationInboundProcessor (INT-001 WI-3, dispatch by job name)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dispatches a member-create job to processMemberCreateJob with attemptsMade+1', async () => {
    vi.mocked(processMemberCreateJob).mockResolvedValue(undefined)
    const data: MemberCreateJobData = {
      jobId: 'mj_x',
      integrationId: 'int-1',
      restaurantId: 'rest-1',
      phoneE164: '+85298765432',
      consentLevel: 'all',
      name: null,
      externalRef: null,
      language: null,
      sendWelcome: true,
      metadata: null,
    }

    await integrationInboundProcessor(job('member-create', data, 2))

    expect(processMemberCreateJob).toHaveBeenCalledWith(data, 3)
  })

  it('dispatches a welcome-send job to processWelcomeSendJob with attemptsMade+1 (INT-001 WI-4)', async () => {
    vi.mocked(processWelcomeSendJob).mockResolvedValue(undefined)
    const data: WelcomeSendJobData = {
      memberId: 'm-1',
      restaurantId: 'rest-1',
      integrationId: 'int-1',
      createJobId: 'mj_x',
    }

    await integrationInboundProcessor(job('welcome-send', data, 1))

    expect(processWelcomeSendJob).toHaveBeenCalledWith(data, 2)
    expect(processMemberCreateJob).not.toHaveBeenCalled()
  })

  it('an unknown job name is logged, not thrown', async () => {
    await expect(integrationInboundProcessor(job('mystery', {}))).resolves.toBeUndefined()
  })
})
