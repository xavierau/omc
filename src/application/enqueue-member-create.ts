// INT-001 WI-3: the route's ONLY write-adjacent step (kanban INT-001
// CONSTRAINT: "route does auth -> validate -> enqueue -> 202 only"). Builds
// the content-addressed job id (T-H3a, WI-2), fast-paths a duplicate
// submission via Redis (T-H3b), reserves per-integration + global queue
// depth (T-M7) BEFORE any Postgres write, writes the `integration_member_jobs`
// row (status `queued`), then enqueues the BullMQ job -- Postgres's own
// `job_id` PRIMARY KEY is the correctness backstop behind the Redis
// fast-path (mirrors `member-create-repository.ts`'s T-H6 pattern).
//
// "Redis down -> 503, zero DB writes" holds by construction: every Redis
// call in this function happens BEFORE the one Postgres write
// (`insertMemberJob`), and every Redis failure returns before reaching it.

import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import type { GlobalQueueCeilingGuard } from './check-global-queue-ceiling'
import { buildMemberJobId, type MemberJobCanonicalInput } from './build-member-job-id'
import { insertMemberJob } from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import { findMemberJobForIntegration } from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import type { MemberCreateJobData } from '@/infrastructure/queue/integration-inbound-queue'

const IDEMPOTENCY_WINDOW_SEC = 24 * 60 * 60

/** Plan §"Per-integration queue-depth cap" default -- used by the route
 * whenever `integration_settings.inbound_queue_cap` is unset (backfilled
 * `null` on every pre-existing integration, per migration 069). */
export const DEFAULT_INBOUND_QUEUE_CAP = 500

export interface EnqueueMemberCreateInput {
  integrationId: string
  restaurantId: string
  phoneE164: string
  phoneLast4: string
  consentLevel: 'none' | 'utility' | 'all'
  name: string | null
  externalRef: string | null
  language: 'en' | 'zh_hk' | null
  sendWelcome: boolean
  metadata: Record<string, unknown> | null
  queueCap: number
}

export interface EnqueueMemberCreateDeps {
  rateLimiter: RateLimiterPort
  globalCeilingGuard: GlobalQueueCeilingGuard
  addMemberCreateJob: (data: MemberCreateJobData) => Promise<void>
  jobIdKey: string
}

export type EnqueueMemberCreateResult =
  | { ok: true; jobId: string; status: 'queued' | 'processing' }
  | { ok: false; status: 503; error: 'queue_depth_exceeded' | 'queue_unavailable' }

function depthCounterKey(integrationId: string): string {
  return `int001:depth:${integrationId}`
}

function idempotencyKey(jobId: string): string {
  return `int001:idem:${jobId}`
}

/** Postgres `succeeded`/`failed` have no slot in the `202` wire contract
 * (`CreateMemberAcceptedResponse.status` is `'queued'|'processing'` only) --
 * a resubmission of an already-completed job still gets a `202` (T-H3b:
 * "same body -> same 202, no second job"), reported as `processing` since
 * that is the closest non-terminal signal; the real outcome is one
 * `GET .../jobs/{jobId}` poll away. */
function toWireStatus(status: 'queued' | 'processing' | 'succeeded' | 'failed'): 'queued' | 'processing' {
  return status === 'queued' ? 'queued' : 'processing'
}

function canonicalInputFrom(input: EnqueueMemberCreateInput): MemberJobCanonicalInput {
  return {
    phone: input.phoneE164,
    consent_level: input.consentLevel,
    name: input.name,
    external_ref: input.externalRef,
    language: input.language,
    send_welcome: input.sendWelcome,
    metadata: input.metadata,
  }
}

async function releaseDepthReservation(rateLimiter: RateLimiterPort, integrationId: string): Promise<void> {
  try {
    await rateLimiter.decr(depthCounterKey(integrationId))
  } catch (err) {
    console.error('[EnqueueMemberCreate] depth reservation release failed', {
      integrationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function enqueueMemberCreate(
  input: EnqueueMemberCreateInput,
  deps: EnqueueMemberCreateDeps
): Promise<EnqueueMemberCreateResult> {
  const jobId = buildMemberJobId(deps.jobIdKey, input.integrationId, input.phoneE164, canonicalInputFrom(input))

  // Fast path (T-H3b): a byte-identical resubmission within 24h. Best
  // effort by design -- Postgres's job_id PK is the real correctness
  // backstop (see below), so a miss here just means the slower path runs.
  let seenBefore = false
  try {
    const { allowed } = await deps.rateLimiter.incrWindow(idempotencyKey(jobId), 1, IDEMPOTENCY_WINDOW_SEC)
    seenBefore = !allowed
  } catch {
    return { ok: false, status: 503, error: 'queue_unavailable' }
  }

  if (seenBefore) {
    const existing = await findMemberJobForIntegration(jobId, input.integrationId)
    if (existing) {
      return { ok: true, jobId, status: toWireStatus(existing.status) }
    }
    // Redis says "seen" but Postgres has no row -- a prior attempt didn't
    // get past the depth/ceiling reservation below. Fall through and retry
    // the full reservation as if this were fresh.
  }

  // Reserve per-integration depth BEFORE any Postgres write.
  let depthCount: number
  try {
    depthCount = await deps.rateLimiter.incr(depthCounterKey(input.integrationId))
  } catch {
    return { ok: false, status: 503, error: 'queue_unavailable' }
  }
  if (depthCount > input.queueCap) {
    await releaseDepthReservation(deps.rateLimiter, input.integrationId)
    return { ok: false, status: 503, error: 'queue_depth_exceeded' }
  }

  let ceiling: { exceeded: boolean }
  try {
    ceiling = await deps.globalCeilingGuard.check()
  } catch {
    await releaseDepthReservation(deps.rateLimiter, input.integrationId)
    return { ok: false, status: 503, error: 'queue_unavailable' }
  }
  if (ceiling.exceeded) {
    await releaseDepthReservation(deps.rateLimiter, input.integrationId)
    return { ok: false, status: 503, error: 'queue_depth_exceeded' }
  }

  // The one Postgres write on this path -- everything above was Redis-only.
  const insertResult = await insertMemberJob({
    jobId,
    integrationId: input.integrationId,
    restaurantId: input.restaurantId,
    assertedLevel: input.consentLevel,
    sendWelcome: input.sendWelcome,
    metadata: input.metadata,
    externalRef: input.externalRef,
    phoneLast4: input.phoneLast4,
  })

  if (!insertResult.inserted) {
    // A concurrent duplicate's Postgres insert won the race -- release our
    // speculative depth reservation (the winner already holds one) and
    // report the winner's row. Do NOT call addMemberCreateJob again: BullMQ
    // job-id dedup would make it a safe no-op, but skipping it avoids a
    // burst of redundant `q.add` calls under a race.
    await releaseDepthReservation(deps.rateLimiter, input.integrationId)
    return { ok: true, jobId, status: toWireStatus(insertResult.row.status) }
  }

  const payload: MemberCreateJobData = {
    jobId,
    integrationId: input.integrationId,
    restaurantId: input.restaurantId,
    phoneE164: input.phoneE164,
    consentLevel: input.consentLevel,
    name: input.name,
    externalRef: input.externalRef,
    language: input.language,
    sendWelcome: input.sendWelcome,
    metadata: input.metadata,
  }

  try {
    await deps.addMemberCreateJob(payload)
  } catch {
    await releaseDepthReservation(deps.rateLimiter, input.integrationId)
    return { ok: false, status: 503, error: 'queue_unavailable' }
  }

  return { ok: true, jobId, status: 'queued' }
}
