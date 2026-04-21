import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  updateOnboardingSettingsForTenant,
  OnboardingSettingsError,
  type UpdateOnboardingInput,
} from '@/application/update-onboarding-settings'
import { MAX_TEMPLATE_LENGTH } from '@/domain/onboarding/onboarding-settings'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const settings = await getOnboardingSettings(restaurantId)
    return NextResponse.json(settings)
  } catch (error) {
    return handleError(error, 'Onboarding settings GET error')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json().catch(() => ({}))
    const input = parsePatchBody(body)
    const settings = await updateOnboardingSettingsForTenant(restaurantId, input)
    return NextResponse.json(settings)
  } catch (error) {
    return handleError(error, 'Onboarding settings PATCH error')
  }
}

function parsePatchBody(body: unknown): UpdateOnboardingInput {
  if (!body || typeof body !== 'object') {
    throw new OnboardingSettingsError('invalid request body', 400)
  }
  const raw = body as Record<string, unknown>
  const input: UpdateOnboardingInput = {}

  if ('welcomeCampaignId' in raw) {
    input.welcomeCampaignId = parseWelcomeCampaignId(raw.welcomeCampaignId)
  }
  if ('returningMemberTemplate' in raw) {
    input.returningMemberTemplate = parseReturningTemplate(raw.returningMemberTemplate)
  }
  if (Object.keys(input).length === 0) {
    throw new OnboardingSettingsError('no fields to update', 400)
  }
  return input
}

function parseWelcomeCampaignId(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string' && value.length > 0) return value
  throw new OnboardingSettingsError(
    'welcomeCampaignId must be a non-empty string or null',
    400
  )
}

function parseReturningTemplate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new OnboardingSettingsError(
      'returningMemberTemplate must be a string or null',
      400
    )
  }
  if (value.length > MAX_TEMPLATE_LENGTH) {
    throw new OnboardingSettingsError(
      `returningMemberTemplate must be ${MAX_TEMPLATE_LENGTH} characters or fewer`,
      400
    )
  }
  return value
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof OnboardingSettingsError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
