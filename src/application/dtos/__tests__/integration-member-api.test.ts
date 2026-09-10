import { describe, expect, it } from 'vitest'
import { OUTBOUND_API_VERSION } from '../integration-member-api'
import type {
  CreateMemberAcceptedResponse,
  CreateMemberRequestBody,
  MemberCreatedEvent,
  MemberJobStatusResponse,
} from '../integration-member-api'

describe('integration-member-api DTOs', () => {
  it('OUTBOUND_API_VERSION is the pinned date-versioned string', () => {
    expect(OUTBOUND_API_VERSION).toBe('2026-09-01')
  })

  it('type-checks a minimal request body', () => {
    const body: CreateMemberRequestBody = { phone: '+85298765432', consent_level: 'all' }
    expect(body.consent_level).toBe('all')
  })

  it('type-checks the 202 accepted response shape', () => {
    const res: CreateMemberAcceptedResponse = {
      job_id: 'mj_1',
      status: 'queued',
      poll_url: '/api/integrations/int-1/members/jobs/mj_1',
    }
    expect(res.status).toBe('queued')
  })

  it('type-checks each job status response variant', () => {
    const variants: MemberJobStatusResponse[] = [
      { status: 'queued', submitted_at: '2026-09-10T00:00:00.000Z', attempts: 0 },
      { status: 'succeeded', member_id: 'm-1', outcome: 'created' },
      { status: 'failed', error: { code: 'internal', message: 'boom' } },
    ]
    expect(variants).toHaveLength(3)
  })

  it('type-checks a member.created outbound event with the pinned api_version', () => {
    const event: MemberCreatedEvent = {
      id: 'evt_1',
      type: 'member.created',
      occurred_at: '2026-09-10T00:00:00.000Z',
      api_version: OUTBOUND_API_VERSION,
      restaurant_id: 'r-1',
      integration_id: 'int-1',
      origin_integration_id: null,
      data: {
        member_id: 'm-1',
        phone_e164: '+85298765432',
        name: null,
        language: 'en',
        source: 'partner_api',
        external_ref: null,
        created_at: '2026-09-10T00:00:00.000Z',
        consent: { effective_level: 'none', utility: 'none', marketing: 'none', grade: null },
      },
    }
    expect(event.type).toBe('member.created')
  })
})
