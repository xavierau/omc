// applyStampUseCase (§4.1 step 4) — wraps the apply_stamp RPC and, on a completion,
// triggers the no-points reward mint + card reset (§6). The mint/send is BEST-EFFORT:
// a transient Kapso/mint failure must NOT roll back the already-committed stamp, so
// the completion is caught and logged, never rethrown.
import { applyStamp } from '@/infrastructure/supabase/repositories/stamp-repository'
import { completeStampCardUseCase } from '@/application/complete-stamp-card'

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
  }

  return {
    outcome: result.outcome,
    stampsCount: result.stampsCount,
    stampsRequired: result.stampsRequired,
    completed: result.completed,
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
