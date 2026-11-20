// createStampCampaignUseCase (plan §9, Story 1). Validates the reward catalog before
// any write: blocks when the restaurant has ZERO rewards, and rejects a reward_id
// that is not in the tenant's catalog. Applies the platform-admin cap policy to the
// chosen max_stamps_per_day (off → silent, warn → allow + surface risk, block →
// reject). New campaigns start status='draft'. The StampCampaign entity validates the
// name/stampsRequired/maxStampsPerDay domain invariants.
import { StampCampaign } from '@/domain/entities/stamp-campaign'
import { evaluateStampCapPolicy } from '@/domain/services/stamp-cap-policy'
import {
  countRewards,
  rewardExistsForRestaurant,
} from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import { createStampCampaign } from '@/infrastructure/supabase/repositories/stamp-campaign-write-repository'
import { getStampCapPolicy } from '@/infrastructure/supabase/repositories/platform-settings-repository'
import type { StampCampaignView } from '@/infrastructure/supabase/repositories/stamp-campaign-mapper'
import {
  NoRewardsError,
  RewardNotFoundError,
  CapBlockedError,
} from './stamp-campaign-errors'

export { NoRewardsError, RewardNotFoundError, CapBlockedError }

export interface CreateStampCampaignInput {
  restaurantId: string
  name: string
  nameZh?: string | null
  stampsRequired: number
  rewardId: string
  maxStampsPerDay?: number
}

export interface CreateStampCampaignResult {
  campaign: StampCampaignView
  warning?: string
}

export async function createStampCampaignUseCase(
  input: CreateStampCampaignInput
): Promise<CreateStampCampaignResult> {
  // Domain invariants (name, stampsRequired, maxStampsPerDay) — throws on violation.
  StampCampaign.create({ id: 'pending', ...input })

  await assertRewardCatalog(input)
  const warning = await applyCapPolicy(input.maxStampsPerDay ?? 1)

  const campaign = await createStampCampaign({
    restaurantId: input.restaurantId,
    name: input.name,
    nameZh: input.nameZh ?? null,
    stampsRequired: input.stampsRequired,
    rewardId: input.rewardId,
    maxStampsPerDay: input.maxStampsPerDay ?? 1,
  })
  return warning ? { campaign, warning } : { campaign }
}

async function assertRewardCatalog(input: CreateStampCampaignInput): Promise<void> {
  if ((await countRewards(input.restaurantId)) === 0) throw new NoRewardsError()
  if (!(await rewardExistsForRestaurant(input.rewardId, input.restaurantId))) {
    throw new RewardNotFoundError()
  }
}

// CAP IMMUTABILITY: max_stamps_per_day is set at CREATE only — there is no edit path
// for it (the PATCH route handles activate/pause/end transitions, never the cap). The
// platform-admin off/warn/block cap policy is therefore enforced exactly once, here at
// create. If an edit path for max_stamps_per_day is ever added, it MUST re-run
// evaluateStampCapPolicy (same off/warn/block semantics), or a tenant could route
// around the platform cap by editing post-create.
async function applyCapPolicy(maxPerDay: number): Promise<string | undefined> {
  const decision = evaluateStampCapPolicy(maxPerDay, await getStampCapPolicy())
  if (!decision.allowed) throw new CapBlockedError(decision.error ?? 'Cap exceeded')
  return decision.warning
}
