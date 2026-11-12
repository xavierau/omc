// INT-001 WI-3: `GET /api/integrations/{integrationId}/members/jobs/{jobId}`
// (spec US-2, T-H4). The repository read is ALREADY scoped by both
// `job_id` and `integration_id` (`findMemberJobForIntegration`), so a
// foreign or unknown id both resolve to `null` here -- this function never
// distinguishes them, which is what makes the route's 404 byte-identical
// either way (never a 403; never a cross-tenant enumeration signal).

import { MemberJob, type MemberJobPartnerView } from '@/domain/entities/member-job'
import {
  findMemberJobForIntegration,
  type MemberJobRow,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'

export type GetMemberJobResult =
  | { ok: true; view: MemberJobPartnerView }
  | { ok: false; status: 404; error: 'not_found' }
  | { ok: false; status: 410; error: 'result_expired' }

function toMemberJob(row: MemberJobRow): MemberJob {
  return MemberJob.fromProps({
    jobId: row.job_id,
    integrationId: row.integration_id,
    restaurantId: row.restaurant_id,
    status: row.status,
    outcome: row.outcome,
    memberId: row.member_id,
    error: row.error_code ? { code: row.error_code, message: row.error_message ?? row.error_code } : null,
    assertedLevel: row.asserted_level,
    consentActions: row.consent_actions,
    welcomeOutcome: row.welcome_outcome,
    welcomeDetail: row.welcome_detail,
    attempts: row.attempts,
    submittedAt: row.submitted_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    resultExpiresAt: row.result_expires_at,
  })
}

export async function getMemberJob(jobId: string, integrationId: string, now: Date): Promise<GetMemberJobResult> {
  const row = await findMemberJobForIntegration(jobId, integrationId)
  if (!row) {
    return { ok: false, status: 404, error: 'not_found' }
  }

  const job = toMemberJob(row)
  if (job.isExpired(now)) {
    return { ok: false, status: 410, error: 'result_expired' }
  }

  return { ok: true, view: job.partnerView() }
}
