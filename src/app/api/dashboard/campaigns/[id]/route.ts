import { NextRequest, NextResponse } from 'next/server'
import {
  getCampaignById,
  getCampaignByIdForRestaurant,
  updateCampaign,
  setCampaignMembers,
  getCampaignMemberIds,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getCampaignTagIds } from '@/infrastructure/supabase/repositories/campaign-tags-repository'
import { assertTagsBelongToTenant } from '@/infrastructure/supabase/repositories/member-tag-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { cascadeCampaignTypeChange } from '@/application/cascade-campaign-type-change'
import { setCampaignTags } from '@/application/set-campaign-tags'
import {
  attachLegacyTemplateIfNeeded,
  validateTemplateLengths,
} from './template-helpers'
import {
  pickAllowed,
  applyImageScopeGuard,
  applyFailureReasonRevivalGuard,
  validatePatchStatus,
} from './patch-helpers'
import {
  parseTargetAudience,
  validateTagIds,
} from '../parse-create-body-audience'
import { handleError, isWelcomeUniqueViolation } from '../campaign-error-response'
import { withTemplateReview, safeCampaignTemplateReviewStates } from '../with-template-review'
import type { UpdateCampaignParams } from '@/infrastructure/supabase/repositories/campaign-repository'
import type { Campaign } from '@/domain/entities/campaign'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Review round 2, item 1: scoped query (SEC-001 pattern) — a
    // cross-tenant id resolves to null exactly like a missing one, never
    // fetch-then-compare-and-leak.
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const campaign = await getCampaignByIdForRestaurant(id, restaurantId)
    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }
    // Issue #102 fix 4: let the UI explain a disabled Send button instead
    // of failing silently. Degrades OFF on enrichment failure (review
    // round 3, item 2) — consistency with the list route.
    const reviewStates = await safeCampaignTemplateReviewStates(
      campaign.restaurantId,
      [campaign]
    )
    const result: Record<string, unknown> = {
      ...withTemplateReview(campaign, reviewStates),
    }
    if (campaign.targetAudience === 'selected') {
      result.memberIds = await getCampaignMemberIds(id)
    } else if (campaign.targetAudience === 'tag') {
      result.tagIds = await getCampaignTagIds(id)
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
    // Review round 3, item 3: 'failed' is system-managed (queue worker
    // only) — reject a direct PATCH before it ever reaches updateCampaign.
    const statusError = validatePatchStatus(body)
    if (statusError) {
      return NextResponse.json({ error: statusError }, { status: 400 })
    }
    // Tag ids are validated (shape + UUID + cap) and their tenant ownership
    // asserted BEFORE updateCampaign. Rejecting only inside setCampaignTags
    // would leave the campaign already flipped to target_audience='tag' with
    // no links — an audience that resolves to nobody (round 2, findings 3+4).
    const tagIds = validateTagIds(body.tagIds, parseTargetAudience(body.targetAudience))
    if (body.targetAudience === 'tag') {
      await assertTagsBelongToTenant(tagIds, restaurantId)
    }
    const changes: UpdateCampaignParams = pickAllowed(body)
    applyImageScopeGuard(changes, existing, restaurantId)
    applyFailureReasonRevivalGuard(changes)
    await attachLegacyTemplateIfNeeded(changes, existing, restaurantId)

    const campaign = await updateCampaign(id, changes)

    if (body.targetAudience !== undefined && body.memberIds) {
      await setCampaignMembers(id, body.memberIds, restaurantId)
    }

    await syncCampaignTags({
      campaignId: id,
      restaurantId,
      nextAudience: body.targetAudience,
      previousAudience: existing.targetAudience,
      tagIds,
    })

    await cascadeCampaignTypeChange({
      restaurantId,
      campaignId: id,
      previousType: existing.type,
      previousStatus: existing.status,
      nextType: changes.type,
      nextStatus: changes.status,
    })

    return NextResponse.json(campaign)
  } catch (error) {
    // The one branch PATCH does not share with create: the same constraint,
    // but copy that tells an editor what to do rather than a creator.
    if (isWelcomeUniqueViolation(error)) {
      return NextResponse.json(
        {
          error:
            'An active welcome campaign already exists for this restaurant. Edit the existing one instead of changing another campaign to welcome.',
        },
        { status: 409 }
      )
    }
    return handleError(error, 'Campaign PATCH error', 'Failed to update campaign')
  }
}

interface SyncTagsArgs {
  campaignId: string
  restaurantId: string
  nextAudience: unknown
  previousAudience: Campaign['targetAudience']
  tagIds: string[]
}

/**
 * Keep `campaign_tags` consistent with the audience the campaign now claims.
 * Switching AWAY from 'tag' must clear the links: leaving them behind means a
 * later switch back silently resurrects a selection the merchant abandoned,
 * and the rows outlive any UI that can show them (review round 2, finding 3).
 */
async function syncCampaignTags(a: SyncTagsArgs): Promise<void> {
  if (a.nextAudience === 'tag') {
    await setCampaignTags(a.campaignId, a.tagIds, a.restaurantId)
    return
  }
  if (a.nextAudience !== undefined && a.previousAudience === 'tag') {
    await setCampaignTags(a.campaignId, [], a.restaurantId)
  }
}
