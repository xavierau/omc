// reverseStampUseCase (§3 / §9) — wraps the reverse_stamp RPC (manual audited
// correction). Floored at 0 by the RPC; never a destructive count edit; actor
// captured in the RPC. Maps the composite result to the staff-facing shape.
import { reverseStamp } from '@/infrastructure/supabase/repositories/stamp-repository'

export interface ReverseStampUseCaseParams {
  restaurantId: string
  memberId: string
  campaignId: string
  actorUserId: string
}

export interface ReverseStampUseCaseResult {
  outcome: 'reversed' | 'at_zero'
  stampsCount: number
  stampsRequired: number
}

export async function reverseStampUseCase(
  params: ReverseStampUseCaseParams
): Promise<ReverseStampUseCaseResult> {
  const result = await reverseStamp(params)
  return {
    outcome: result.outcome,
    stampsCount: result.stampsCount,
    stampsRequired: result.stampsRequired,
  }
}
