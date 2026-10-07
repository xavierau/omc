// transitionStampCampaignUseCase (plan §9) — activate / pause / end a stamp campaign.
// Loads the tenant-scoped campaign, applies the status transition via the StampCampaign
// entity (which computes honor_until on end = now + 14d), and persists. ONE active
// campaign per restaurant is DB-enforced (uq_stamp_campaigns_one_active); a unique
// violation on activate is surfaced as OneActiveCampaignError so the route returns a
// friendly "Pause the running card first." instead of a 500.
import { StampCampaign } from '@/domain/entities/stamp-campaign'
import { getStampCampaignById } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import {
  setStampCampaignStatus,
  StampCampaignUniqueViolationError,
} from '@/infrastructure/supabase/repositories/stamp-campaign-write-repository'
import type { StampCampaignView } from '@/infrastructure/supabase/repositories/stamp-campaign-mapper'
import { StampCampaignNotFoundError } from './stamp-campaign-errors'

export { StampCampaignNotFoundError }

const ACTIVE_CONSTRAINT = 'uq_stamp_campaigns_one_active'

/** Activate rejected because another campaign is already active for this tenant. */
export class OneActiveCampaignError extends Error {
  constructor() {
    super('Pause the running card first.')
    this.name = 'OneActiveCampaignError'
  }
}

export type StampCampaignAction = 'activate' | 'pause' | 'end'

export interface TransitionStampCampaignInput {
  id: string
  restaurantId: string
  action: StampCampaignAction
}

export async function transitionStampCampaignUseCase(
  input: TransitionStampCampaignInput
): Promise<StampCampaignView> {
  const existing = await getStampCampaignById(input.id, input.restaurantId)
  if (!existing) throw new StampCampaignNotFoundError()

  const next = applyAction(StampCampaign.fromProps(existing), input.action).snapshot
  return persist(input, next)
}

function applyAction(
  campaign: StampCampaign,
  action: StampCampaignAction
): StampCampaign {
  if (action === 'activate') return campaign.activate()
  if (action === 'pause') return campaign.pause()
  return campaign.end()
}

async function persist(
  input: TransitionStampCampaignInput,
  next: { status: StampCampaignView['status']; honorUntil: string | null }
): Promise<StampCampaignView> {
  try {
    return await setStampCampaignStatus({
      id: input.id,
      restaurantId: input.restaurantId,
      status: next.status,
      ...(next.honorUntil ? { honorUntil: next.honorUntil } : {}),
    })
  } catch (err) {
    if (isOneActiveViolation(err)) throw new OneActiveCampaignError()
    throw err
  }
}

function isOneActiveViolation(err: unknown): boolean {
  return (
    err instanceof StampCampaignUniqueViolationError &&
    err.constraint === ACTIVE_CONSTRAINT
  )
}
