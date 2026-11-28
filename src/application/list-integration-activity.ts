// INT-001 WI-8 US-9/§8.1: `GET /api/dashboard/pos-integrations/[id]/activity`
// -- the OWNER-visible activity log (member jobs). Deliberately builds its
// wire shape straight from `MemberJobRow` rather than round-tripping
// through the `MemberJob` domain entity: that entity's ONLY serialisation
// method, `partnerView()`, is scoped to the partner-safe field subset by
// design ("the ONLY way this entity may be serialised back to a partner")
// and has no owner-view counterpart -- adding one would blur a boundary
// WI-1 drew deliberately. `phone_last4` only, never the full phone (T-M1).

import {
  findMemberJobsForIntegration,
  type MemberJobRow,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export interface IntegrationActivityItem {
  jobId: string
  status: MemberJobRow['status']
  outcome: MemberJobRow['outcome']
  assertedLevel: MemberJobRow['asserted_level']
  consentActions: MemberJobRow['consent_actions']
  welcomeOutcome: string | null
  welcomeDetail: MemberJobRow['welcome_detail']
  phoneLast4: string
  submittedAt: string
}

export interface ListIntegrationActivityResult {
  data: IntegrationActivityItem[]
  nextCursor: string | null
}

export async function listIntegrationActivity(
  integrationId: string,
  restaurantId: string,
  args: { cursor?: string; limit?: number } = {}
): Promise<ListIntegrationActivityResult> {
  const limit = Math.min(args.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)

  const rows = await findMemberJobsForIntegration(integrationId, restaurantId, { cursor: args.cursor, limit })

  const data: IntegrationActivityItem[] = rows.map((row) => ({
    jobId: row.job_id,
    status: row.status,
    outcome: row.outcome,
    assertedLevel: row.asserted_level,
    consentActions: row.consent_actions,
    welcomeOutcome: row.welcome_outcome,
    welcomeDetail: row.welcome_detail,
    phoneLast4: row.phone_last4,
    submittedAt: row.submitted_at,
  }))

  const nextCursor = rows.length === limit ? rows[rows.length - 1].submitted_at : null

  return { data, nextCursor }
}
