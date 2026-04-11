import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { updateTenantCampaignSettings } from '@/application/update-tenant-campaign-settings'
import { DEFAULT_SETTINGS } from '@/domain/services/campaign-guardrails'
import {
  getSettingsForTenant,
  getMonthlyTenantSends,
  getUnsubscribeStats,
} from '@/infrastructure/supabase/repositories/campaign-settings-repository'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 })
    }
    const [settings, monthlySends, unsubStats] = await Promise.all([
      getSettingsForTenant(id),
      getMonthlyTenantSends(id),
      getUnsubscribeStats(id),
    ])

    const effectiveSettings = settings ?? { restaurantId: id, ...DEFAULT_SETTINGS }
    const unsubscribeRate = unsubStats.total > 0
      ? unsubStats.unsubscribed / unsubStats.total
      : 0

    return NextResponse.json({
      settings: effectiveSettings,
      usage: { monthlySends, unsubscribeRate },
      warnings: buildWarnings(monthlySends, effectiveSettings.monthlySendLimit),
    })
  } catch (error) {
    return handleError(error, 'Campaign settings GET error')
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 })
    }
    const body = await request.json()
    validateSettingsInput(body)

    const updated = await updateTenantCampaignSettings(id, {
      monthlySendLimit: body.monthlySendLimit,
      dailyCampaignLimit: body.dailyCampaignLimit,
      maxUnsubscribeRate: body.maxUnsubscribeRate,
    })

    return NextResponse.json(updated)
  } catch (error) {
    return handleError(error, 'Campaign settings PUT error')
  }
}

function validateSettingsInput(body: Record<string, unknown>): void {
  if (body.monthlySendLimit !== undefined) {
    if (
      typeof body.monthlySendLimit !== 'number' ||
      !Number.isInteger(body.monthlySendLimit) ||
      body.monthlySendLimit <= 0 ||
      body.monthlySendLimit > 1_000_000
    ) {
      throw new ValidationError('monthlySendLimit must be a positive integer (max 1,000,000)')
    }
  }
  if (body.dailyCampaignLimit !== undefined) {
    if (
      typeof body.dailyCampaignLimit !== 'number' ||
      !Number.isInteger(body.dailyCampaignLimit) ||
      body.dailyCampaignLimit <= 0 ||
      body.dailyCampaignLimit > 100
    ) {
      throw new ValidationError('dailyCampaignLimit must be a positive integer (max 100)')
    }
  }
  if (body.maxUnsubscribeRate !== undefined) {
    if (
      typeof body.maxUnsubscribeRate !== 'number' ||
      !Number.isFinite(body.maxUnsubscribeRate) ||
      body.maxUnsubscribeRate <= 0 ||
      body.maxUnsubscribeRate > 1
    ) {
      throw new ValidationError('maxUnsubscribeRate must be a finite number between 0 and 1')
    }
  }
}

function buildWarnings(monthlySends: number, limit: number): string[] {
  const threshold = 0.8
  if (limit > 0 && monthlySends / limit >= threshold) {
    return [`Approaching monthly send limit (${monthlySends}/${limit})`]
  }
  return []
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
