// applyStampUseCase (§4.1 step 4) — wraps the apply_stamp RPC and, on a completion,
// triggers the no-points reward mint + card reset (§6). On a non-completing grant it
// fires the "X to go" come-back nudge (§7) — the nudge use case owns the trigger guard
// (fires only at stamps_required - 1) and all marketing gating. Both side-effects are
// BEST-EFFORT: a transient Kapso/mint failure must NOT roll back the already-committed
// stamp, so they are caught and logged, never rethrown.
import { applyStamp } from '@/infrastructure/supabase/repositories/stamp-repository'
import { completeStampCardUseCase } from '@/application/complete-stamp-card'
import { maybeSendStampNudge } from '@/application/stamp-nudge'

export interface ApplyStampUseCaseParams {
  restaurantId: string
  memberId: string
  campaignId: string
  actorUserId: string
  maxPerDay: number
  phone: string
  phoneNumberId: string
  language: string | null
}

export interface ApplyStampUseCaseResult {
  outcome: 'stamped' | 'already_stamped_today'
  stampsCount: number
  stampsRequired: number
  completed: boolean
}

export async function applyStampUseCase(
  params: ApplyStampUseCaseParams
): Promise<ApplyStampUseCaseResult> {
  const result = await applyStamp({
    restaurantId: params.restaurantId,
    memberId: params.memberId,
    campaignId: params.campaignId,
    actorUserId: params.actorUserId,
    maxPerDay: params.maxPerDay,
  })

  if (result.completed) {
    await mintBestEffort(params, result.cardId)
  } else if (result.outcome === 'stamped') {
    await nudgeBestEffort(params, result)
  }

  return {
    outcome: result.outcome,
    stampsCount: result.stampsCount,
    stampsRequired: result.stampsRequired,
    completed: result.completed,
  }
}

async function nudgeBestEffort(
  params: ApplyStampUseCaseParams,
  result: { cardId: string; stampsCount: number; stampsRequired: number }
): Promise<void> {
  try {
    await maybeSendStampNudge({
      restaurantId: params.restaurantId,
      memberId: params.memberId,
      cardId: result.cardId,
      phoneNumberId: params.phoneNumberId,
      stampsCount: result.stampsCount,
      stampsRequired: result.stampsRequired,
    })
  } catch (err) {
    console.warn('[ApplyStamp] X-to-go nudge failed (stamp committed):', err)
  }
}

async function mintBestEffort(
  params: ApplyStampUseCaseParams,
  cardId: string
): Promise<void> {
  try {
    await completeStampCardUseCase({
      restaurantId: params.restaurantId,
      memberId: params.memberId,
      campaignId: params.campaignId,
      cardId,
      phone: params.phone,
      phoneNumberId: params.phoneNumberId,
      language: params.language,
    })
  } catch (err) {
    console.warn('[ApplyStamp] reward mint/notify failed (stamp committed):', err)
  }
}
