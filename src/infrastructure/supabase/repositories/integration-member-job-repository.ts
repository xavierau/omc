// INT-001 WI-3: reads/writes `integration_member_jobs` (migration 070).
// T-H4: every read is scoped by BOTH `job_id` AND `integration_id` -- an
// id belonging to another integration must read as "not found", never
// leak via a fetch-then-compare (issue #111 lesson,
// `principle_authorize_by_scoped_query`). T-M1: this row NEVER carries the
// full phone (`phone_last4` only) -- the member row holds the phone.
//
// `insertMemberJob` mirrors `member-create-repository.ts`'s own T-H6
// pattern: `job_id` is the PRIMARY KEY (deterministic, content-addressed --
// see `build-member-job-id.ts`), so a concurrent duplicate submission hits
// `23505` and this file re-selects rather than throwing. That Postgres
// uniqueness is the CORRECTNESS backstop behind `enqueue-member-create.ts`'s
// faster Redis idempotency check (T-H3b).

import { createServerSupabaseClient } from '../client'

export type MemberJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed'
export type MemberJobOutcome = 'created' | 'existing'
export type AssertedConsentLevel = 'none' | 'utility' | 'all'

export interface MemberJobRow {
  job_id: string
  integration_id: string
  restaurant_id: string
  status: MemberJobStatus
  outcome: MemberJobOutcome | null
  member_id: string | null
  error_code: string | null
  error_message: string | null
  attempts: number
  asserted_level: AssertedConsentLevel
  send_welcome: boolean
  consent_actions: Record<string, unknown> | null
  welcome_outcome: string | null
  welcome_detail: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  external_ref: string | null
  phone_last4: string
  submitted_at: string
  started_at: string | null
  completed_at: string | null
  result_expires_at: string | null
}

export interface InsertMemberJobArgs {
  jobId: string
  integrationId: string
  restaurantId: string
  assertedLevel: AssertedConsentLevel
  sendWelcome: boolean
  metadata: Record<string, unknown> | null
  externalRef: string | null
  phoneLast4: string
}

export interface InsertMemberJobResult {
  /** false when a row with this job_id already existed (T-H3b idempotent
   * resubmission) -- `row` is always the current, authoritative row either
   * way. */
  inserted: boolean
  row: MemberJobRow
}

const COLUMNS =
  'job_id, integration_id, restaurant_id, status, outcome, member_id, error_code, error_message, attempts, asserted_level, send_welcome, consent_actions, welcome_outcome, welcome_detail, metadata, external_ref, phone_last4, submitted_at, started_at, completed_at, result_expires_at'

export async function insertMemberJob(args: InsertMemberJobArgs): Promise<InsertMemberJobResult> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_member_jobs')
    .insert({
      job_id: args.jobId,
      integration_id: args.integrationId,
      restaurant_id: args.restaurantId,
      status: 'queued',
      asserted_level: args.assertedLevel,
      send_welcome: args.sendWelcome,
      metadata: args.metadata,
      external_ref: args.externalRef,
      phone_last4: args.phoneLast4,
    })
    .select(COLUMNS)
    .single()

  if (!error) {
    if (!data) throw new Error('insertMemberJob: insert succeeded but returned no row')
    return { inserted: true, row: data as unknown as MemberJobRow }
  }

  if ((error as { code?: string }).code !== '23505') {
    throw new Error(`insertMemberJob: ${error.message}`)
  }

  const existing = await findMemberJobByIdUnscoped(args.jobId)
  if (!existing) {
    throw new Error('insertMemberJob: unique violation on insert but no row found on re-select')
  }
  return { inserted: false, row: existing }
}

/** Internal-only: unscoped by integration -- used exclusively right after a
 * 23505 on `insertMemberJob`, where the caller already knows `jobId` is
 * content-addressed from ITS OWN `integrationId` (T-H3b's key construction
 * includes `integrationId`), so no cross-tenant read is possible here. Every
 * partner-facing read goes through `findMemberJobForIntegration` instead. */
async function findMemberJobByIdUnscoped(jobId: string): Promise<MemberJobRow | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_member_jobs')
    .select(COLUMNS)
    .eq('job_id', jobId)
    .maybeSingle()
  if (error) throw new Error(`findMemberJobByIdUnscoped: ${error.message}`)
  return data as unknown as MemberJobRow | null
}

/** T-H4: the ONLY partner-facing read. Scoped by BOTH `job_id` AND
 * `integration_id` -- a job belonging to another integration returns null,
 * identical to an unknown job id. */
export async function findMemberJobForIntegration(
  jobId: string,
  integrationId: string
): Promise<MemberJobRow | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('integration_member_jobs')
    .select(COLUMNS)
    .eq('job_id', jobId)
    .eq('integration_id', integrationId)
    .maybeSingle()
  if (error) throw new Error(`findMemberJobForIntegration: ${error.message}`)
  return data as unknown as MemberJobRow | null
}

export interface CompleteMemberJobSucceededArgs {
  jobId: string
  outcome: MemberJobOutcome
  memberId: string
  consentActions: Record<string, unknown>
  welcomeOutcome: string
  welcomeDetail: Record<string, unknown> | null
  completedAt: string
  resultExpiresAt: string
}

export async function completeMemberJobSucceeded(args: CompleteMemberJobSucceededArgs): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('integration_member_jobs')
    .update({
      status: 'succeeded',
      outcome: args.outcome,
      member_id: args.memberId,
      consent_actions: args.consentActions,
      welcome_outcome: args.welcomeOutcome,
      welcome_detail: args.welcomeDetail,
      completed_at: args.completedAt,
      result_expires_at: args.resultExpiresAt,
    })
    .eq('job_id', args.jobId)
  if (error) throw new Error(`completeMemberJobSucceeded: ${error.message}`)
}

export interface CompleteMemberJobFailedArgs {
  jobId: string
  errorCode: string
  errorMessage: string
  completedAt: string
  resultExpiresAt: string
}

export async function completeMemberJobFailed(args: CompleteMemberJobFailedArgs): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('integration_member_jobs')
    .update({
      status: 'failed',
      error_code: args.errorCode,
      error_message: args.errorMessage,
      completed_at: args.completedAt,
      result_expires_at: args.resultExpiresAt,
    })
    .eq('job_id', args.jobId)
  if (error) throw new Error(`completeMemberJobFailed: ${error.message}`)
}

/** WI-8 `list-integration-activity.ts` (owner-visible activity log, §8.1's
 * `not in any partner response` field set: outcome, asserted level,
 * consent actions, welcome outcome/detail, `phone_last4` only, submitted_at
 * -- never the full phone). Cursor is `submitted_at` of the last row on the
 * previous page (exclusive `<`), scoped by `restaurantId` (not just
 * `integrationId`) matching this table's own RLS/query convention
 * elsewhere in this file (T-H4's "scope every read" lesson generalised). */
export async function findMemberJobsForIntegration(
  integrationId: string,
  restaurantId: string,
  args: { cursor?: string; limit: number }
): Promise<MemberJobRow[]> {
  const supabase = createServerSupabaseClient()
  let query = supabase
    .from('integration_member_jobs')
    .select(COLUMNS)
    .eq('integration_id', integrationId)
    .eq('restaurant_id', restaurantId)
    .order('submitted_at', { ascending: false })
    .limit(args.limit)
  if (args.cursor) query = query.lt('submitted_at', args.cursor)
  const { data, error } = await query
  if (error) throw new Error(`findMemberJobsForIntegration: ${error.message}`)
  return (data ?? []) as unknown as MemberJobRow[]
}

/** Stamps the row `processing` + `started_at` and bumps `attempts` -- called
 * once at the START of each worker attempt (including retries), so a
 * partner polling mid-retry sees an honest `attempts` count (US-2). */
export async function markMemberJobProcessing(jobId: string, startedAt: string, attempts: number): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('integration_member_jobs')
    .update({ status: 'processing', started_at: startedAt, attempts })
    .eq('job_id', jobId)
  if (error) throw new Error(`markMemberJobProcessing: ${error.message}`)
}

/** WI-14 (G-1): records `member_id` as soon as `createOrGetMember` resolves
 * it -- BEFORE the job reaches its own terminal `succeeded` state. A crash
 * or transient failure between this point and `completeMemberJobSucceeded`
 * used to leave the job row with no record of which member THIS job
 * already created; a retry's own `createOrGetMember` then sees that member
 * as `existing` and `decideWelcome`'s D1 rule ("existing member never gets
 * a welcome") incorrectly treats it as genuinely pre-existing, silently
 * dropping the welcome the first attempt would have sent. Scoped by
 * `job_id` alone, matching this file's other non-partner-facing writers --
 * never partner input, no T-H4 scoping needed. Never touches
 * `status`/`outcome`/`completed_at`; those stay `completeMemberJobSucceeded`'s
 * job alone. */
export async function recordMemberJobMemberId(jobId: string, memberId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('integration_member_jobs')
    .update({ member_id: memberId })
    .eq('job_id', jobId)
  if (error) throw new Error(`recordMemberJobMemberId: ${error.message}`)
}

/** INT-001 WI-4: the `welcome-send` job's own write -- ONLY `welcome_outcome`
 * / `welcome_detail`, never `status`/`outcome`/`member_id`/`completed_at`.
 * The create job already reached its own terminal `succeeded` state (WI-3);
 * a send-time re-check outcome (`skipped_*`, `sent`, `failed`) updates the
 * welcome fields on that SAME row without disturbing it (plan: "the create
 * job unaffected"). Scoped by `job_id` alone, matching this file's other
 * writers (`completeMemberJobSucceeded`/`Failed`) -- `createJobId` always
 * originates from this worker's own trusted job payload, never partner
 * input, so no T-H4-style scoping is needed here. */
export async function updateMemberJobWelcomeOutcome(
  jobId: string,
  welcomeOutcome: string,
  welcomeDetail: Record<string, unknown> | null
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('integration_member_jobs')
    .update({ welcome_outcome: welcomeOutcome, welcome_detail: welcomeDetail })
    .eq('job_id', jobId)
  if (error) throw new Error(`updateMemberJobWelcomeOutcome: ${error.message}`)
}

export interface NonTerminalJobCount {
  integrationId: string
  count: number
}

/** WI-13 (Gap B): the depth-counter reconciliation sweep's source of truth
 * -- "a counter is a cache, the table is truth" (the plan's own
 * architecture text for the 5-min sweeper). Backed by the
 * `count_non_terminal_member_jobs_by_integration` RPC (migration 073), a
 * server-side GROUP BY -- cheaper and simpler than paging every non-terminal
 * row over PostgREST just to count them client-side. */
export async function countNonTerminalJobsByIntegration(): Promise<NonTerminalJobCount[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('count_non_terminal_member_jobs_by_integration')
  if (error) throw new Error(`countNonTerminalJobsByIntegration: ${error.message}`)
  return ((data ?? []) as { integration_id: string; non_terminal_count: number }[]).map((row) => ({
    integrationId: row.integration_id,
    count: row.non_terminal_count,
  }))
}

/** Single-integration sibling of countNonTerminalJobsByIntegration, for the
 * manual-recovery code path (reconcileIntegrationDepthCounter). */
export async function countNonTerminalJobsForIntegration(integrationId: string): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('count_non_terminal_member_jobs_for_integration', {
    p_integration_id: integrationId,
  })
  if (error) throw new Error(`countNonTerminalJobsForIntegration: ${error.message}`)
  return (data as number | null) ?? 0
}
