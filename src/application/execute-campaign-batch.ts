import { sendToMember } from './execute-campaign-broadcast'
import { loadMarketingGateDecisions } from './execute-campaign-batch-gate'
import { loadRerunPrefetch, type RerunPrefetch } from './execute-campaign-rerun-prefetch'
import { sortByEngagementTier } from './sort-by-engagement-tier'
import { planChunks, type ChunkPlan } from './execute-campaign-batch-chunker'
import { maybeLogProbeBoundary } from './execute-campaign-batch-probe-log'
import {
  emptyCounters,
  logSummary,
  outcomeFromDecision,
  tally,
  type MemberOutcome,
  type SkipCounters,
} from './execute-campaign-batch-counters'
import type { SkipDecision } from '@/domain/value-objects/marketing-skip-reason'
import type { PacingConfig } from '@/domain/value-objects/pacing-strategy'
import { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { Campaign } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'

// WAQ-010: between-chunk pause. Defaults to 1s (legacy BATCH_DELAY_MS) so
// existing tests stay fast. Production may override via WAQ_BATCH_DELAY_MS.
function batchDelayMs(): number {
  const raw = process.env.WAQ_BATCH_DELAY_MS
  if (raw === undefined) return 1000
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 1000
}

// WAQ-010 review fix: inner concurrency ceiling. Chunks set the KPI-pacing
// boundary (probe vs scale, up to 1000 members each per migration 043), but
// firing an entire chunk through Promise.allSettled would exhaust Supabase
// pools and trigger Kapso rate limits. The legacy code's BATCH_SIZE=20 gave
// implicit throttling; we restore that as an explicit sub-batch ceiling.
const CONCURRENCY_LIMIT = 20

export interface SendContext {
  campaign: Campaign
  phoneNumberId: string
  template: WhatsAppTemplate | null
  restaurantDefaultLanguage: string | null
  trackingEnabled: boolean
  perUserMarketingCap: number
  // WAQ-010: per-tenant probe pacing. Captured at run-start so a mid-batch
  // settings update doesn't change ordering or chunk sizes partway through.
  pacingConfig: PacingConfig
}

// #127 / CAMP-007: returns the tally so the orchestrator can distinguish an
// all-failed run from a completed one instead of marking both `completed`.
export async function sendInBatches(
  members: Member[],
  ctx: SendContext
): Promise<SkipCounters> {
  const counters = emptyCounters()
  const ordered = orderForPacing(members, ctx.pacingConfig)
  const plan = planChunks(ordered, ctx.pacingConfig)
  const isMarketing = isMarketingRun(ctx)
  const logCtx = { campaignId: ctx.campaign.id, pacingConfig: ctx.pacingConfig }
  for (let i = 0; i < plan.length; i++) {
    await runChunk(plan[i], ctx, isMarketing, counters)
    maybeLogProbeBoundary(plan, i, logCtx, counters)
    if (i < plan.length - 1) await delay(batchDelayMs())
  }
  logSummary(members.length, counters)
  return counters
}

function orderForPacing(members: Member[], config: PacingConfig): Member[] {
  // `naive` opts out of engagement sorting — preserves legacy insertion-order
  // behaviour so tenants on that strategy get the exact pre-WAQ-010 send pattern.
  return config.strategy === 'engagement_tier'
    ? sortByEngagementTier(members)
    : members
}

async function runChunk(
  chunk: ChunkPlan,
  ctx: SendContext,
  isMarketing: boolean,
  counters: SkipCounters
): Promise<void> {
  // Bulk-load gate decisions once per chunk (WAQ-007 N+1 fix) — must stay
  // outside the inner sub-batch loop so we don't issue multiple DB queries.
  const decisions = isMarketing ? await loadDecisions(chunk.members, ctx) : null
  // #131 / CAMP-002: same bulk-per-chunk discipline for the re-run ledger.
  const prefetch = await loadRerunPrefetch(chunk.members, ctx)
  for (let i = 0; i < chunk.members.length; i += CONCURRENCY_LIMIT) {
    const subBatch = chunk.members.slice(i, i + CONCURRENCY_LIMIT)
    const results = await Promise.allSettled(
      subBatch.map((m) => attemptMember(m, ctx, decisions, prefetch))
    )
    tally(results, counters)
    if (i + CONCURRENCY_LIMIT < chunk.members.length) {
      await delay(batchDelayMs())
    }
  }
}

async function loadDecisions(
  batch: Member[],
  ctx: SendContext
): Promise<Map<string, SkipDecision>> {
  return loadMarketingGateDecisions({
    restaurantId: ctx.campaign.restaurantId,
    cap: ctx.perUserMarketingCap,
    batch,
  })
}

async function attemptMember(
  member: Member,
  ctx: SendContext,
  decisions: Map<string, SkipDecision> | null,
  prefetch: RerunPrefetch
): Promise<MemberOutcome> {
  // A member this campaign already reached (non-failed body row) is done —
  // a re-run only reaches the ones Meta rejected.
  if (prefetch.countedMemberIds.has(member.id)) return 'skipped_already_sent'
  if (decisions !== null) {
    const outcome = outcomeFromDecision(decisions.get(member.phone))
    if (outcome !== 'allowed') return outcome
  }
  return sendToMember(member, ctx, prefetch)
}

function isMarketingRun(ctx: SendContext): boolean {
  // Only WhatsApp template sends carry a Meta-classified category. Inline
  // text/QR campaigns go out as 'service' and are not gated by marketing
  // consent or per-user cooldown.
  return ctx.template?.category === 'MARKETING'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
