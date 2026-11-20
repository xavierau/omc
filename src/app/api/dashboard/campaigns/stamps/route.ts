// Owner stamp-campaign CRUD (plan §9). GET = list; POST = create a draft (reward-
// catalog + cap-policy validated in the use case); PATCH = activate/pause/end. The
// one-active rule and zero-rewards/cap guards surface as friendly statuses via
// mapStampCampaignError. Fail-closed tenant guard scopes every operation.
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { listStampCampaigns } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import { createStampCampaignUseCase } from '@/application/create-stamp-campaign-use-case'
import {
  transitionStampCampaignUseCase,
  type StampCampaignAction,
} from '@/application/transition-stamp-campaign-use-case'
import { mapStampCampaignError } from './route-errors'

const ACTIONS: StampCampaignAction[] = ['activate', 'pause', 'end']

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const campaigns = await listStampCampaigns(restaurantId)
    return NextResponse.json({ campaigns })
  } catch (error) {
    return mapStampCampaignError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json().catch(() => ({}))
    const err = validateCreateBody(body)
    if (err) return NextResponse.json({ error: err }, { status: 400 })

    const result = await createStampCampaignUseCase({
      restaurantId,
      name: body.name,
      nameZh: typeof body.nameZh === 'string' ? body.nameZh : null,
      stampsRequired: body.stampsRequired,
      rewardId: body.rewardId,
      maxStampsPerDay: body.maxStampsPerDay,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return mapStampCampaignError(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json().catch(() => ({}))
    if (!isValidTransition(body)) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }
    const campaign = await transitionStampCampaignUseCase({
      id: body.id,
      restaurantId,
      action: body.action,
    })
    return NextResponse.json(campaign)
  } catch (error) {
    return mapStampCampaignError(error)
  }
}

function validateCreateBody(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== 'string') return 'name is required'
  if (!Number.isInteger(body.stampsRequired) || (body.stampsRequired as number) < 1) {
    return 'stampsRequired must be a positive integer'
  }
  if (!body.rewardId || typeof body.rewardId !== 'string') return 'rewardId is required'
  if (
    body.maxStampsPerDay !== undefined &&
    (!Number.isInteger(body.maxStampsPerDay) || (body.maxStampsPerDay as number) < 1)
  ) {
    return 'maxStampsPerDay must be a positive integer'
  }
  return null
}

function isValidTransition(
  body: Record<string, unknown>
): body is { id: string; action: StampCampaignAction } {
  return (
    typeof body.id === 'string' &&
    body.id.length > 0 &&
    ACTIONS.includes(body.action as StampCampaignAction)
  )
}
