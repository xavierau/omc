import { NextRequest, NextResponse } from 'next/server'
import {
  getCampaignById,
  updateCampaign,
  setCampaignMembers,
  getCampaignMemberIds,
  CrossTenantMemberError,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { MAX_TEMPLATE_LENGTH } from '@/domain/onboarding/onboarding-settings'
import type { UpdateCampaignParams } from '@/infrastructure/supabase/repositories/campaign-repository'
import type { Campaign } from '@/domain/entities/campaign'
import type { LanguageCode } from '@/domain/value-objects/language'

const ALLOWED = new Set([
  'name',
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

    return NextResponse.json(campaign)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    if (error instanceof CrossTenantMemberError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
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

/**
 * Dual-write the legacy `template` column when the caller touches either
 * bilingual field. Resolve the chosen language from the restaurant's
 * `default_language`, falling back to the other language, then to the
 * existing legacy value. An explicit `template` in the patch takes
 * precedence and bypasses this derivation.
 */
async function attachLegacyTemplateIfNeeded(
  changes: UpdateCampaignParams,
  existing: Campaign,
  restaurantId: string
): Promise<void> {
  if (changes.template !== undefined) return
  const enTouched = changes.templateEn !== undefined
  const zhTouched = changes.templateZhHk !== undefined
  if (!enTouched && !zhTouched) return

  const effectiveEn = enTouched
    ? normalize(changes.templateEn)
    : normalize(existing.templateEn)
  const effectiveZhHk = zhTouched
    ? normalize(changes.templateZhHk)
    : normalize(existing.templateZhHk)
  const lang: LanguageCode = await getRestaurantDefaultLanguage(restaurantId)
  const primary = lang === 'en' ? effectiveEn : effectiveZhHk
  const fallback = lang === 'en' ? effectiveZhHk : effectiveEn
  changes.legacyTemplate = primary ?? fallback ?? normalize(existing.template) ?? ''
}

function normalize(value: string | null | undefined): string | null {
  return value && value.trim() !== '' ? value : null
}

function validateTemplateLengths(body: Record<string, unknown>): string | null {
  for (const key of ['template', 'templateEn', 'templateZhHk'] as const) {
    const value = body[key]
    if (typeof value === 'string' && value.length > MAX_TEMPLATE_LENGTH) {
      return `${key} must be ${MAX_TEMPLATE_LENGTH} characters or fewer`
    }
  }
  return null
}
