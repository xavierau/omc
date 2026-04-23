import { NextRequest, NextResponse } from 'next/server'
import {
  getCampaignById,
  updateCampaign,
  setCampaignMembers,
  getCampaignMemberIds,
  CrossTenantMemberError,
  CampaignUniqueViolationError,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { cascadeWelcomeType } from './cascade-welcome-type'
import {
  attachLegacyTemplateIfNeeded,
  validateTemplateLengths,
} from './template-helpers'
import type { UpdateCampaignParams } from '@/infrastructure/supabase/repositories/campaign-repository'

const ALLOWED = new Set([
  'name',
  'type',
  'template',
  'templateEn',
  'templateZhHk',
  'couponConfig',
  'schedule',
  'scheduledAt',
  'whatsappTemplateId',
  'status',
  'targetAudience',
])

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await getTenantContext()
    const { id } = await params
    const campaign = await getCampaignById(id)
    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }
    const result: Record<string, unknown> = { ...campaign }
    if (campaign.targetAudience === 'selected') {
      result.memberIds = await getCampaignMemberIds(id)
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Campaign GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load campaign' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const existing = await getCampaignById(id)
    if (!existing) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }
    if (existing.restaurantId !== restaurantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const templateError = validateTemplateLengths(body)
    if (templateError) {
      return NextResponse.json({ error: templateError }, { status: 400 })
    }
    const changes: UpdateCampaignParams = pickAllowed(body)
    await attachLegacyTemplateIfNeeded(changes, existing, restaurantId)

    const campaign = await updateCampaign(id, changes)

    if (body.targetAudience !== undefined && body.memberIds) {
      await setCampaignMembers(id, body.memberIds, restaurantId)
    }

    await cascadeWelcomeType({
      restaurantId,
      campaignId: id,
      previousType: existing.type,
      nextType: changes.type,
    })

    return NextResponse.json(campaign)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    if (error instanceof CrossTenantMemberError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    if (
      error instanceof CampaignUniqueViolationError &&
      error.constraint === 'idx_campaigns_one_active_welcome_per_restaurant'
    ) {
      return NextResponse.json(
        {
          error:
            'An active welcome campaign already exists for this restaurant. Edit the existing one instead of changing another campaign to welcome.',
        },
        { status: 409 }
      )
    }
    console.error('Campaign PATCH error:', (error as Error)?.message, (error as Error)?.stack)
    return NextResponse.json(
      { error: 'Failed to update campaign' },
      { status: 500 }
    )
  }
}

function pickAllowed(body: Record<string, unknown>): UpdateCampaignParams {
  const changes: Record<string, unknown> = {}
  for (const key of ALLOWED) {
    if (body[key] !== undefined) changes[key] = body[key]
  }
  return changes as UpdateCampaignParams
}
