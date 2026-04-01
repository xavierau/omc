import { NextRequest, NextResponse } from 'next/server'
import {
  listCampaigns,
  createCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

const ALLOWED_TYPES = ['welcome', 'winback', 'birthday', 'promo'] as const
const ALLOWED_STATUSES = ['draft', 'active'] as const
const DISCOUNT_TYPES = ['percentage', 'fixed_amount'] as const

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const campaigns = await listCampaigns(restaurantId)
    return NextResponse.json({ campaigns })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Campaigns API error:', error)
    return NextResponse.json(
      { error: 'Failed to load campaigns' },
      { status: 500 }
    )
  }
}

function validateCouponConfig(config: unknown): string | null {
  if (!config || typeof config !== 'object') return 'couponConfig must be an object'
  const c = config as Record<string, unknown>
  if (!DISCOUNT_TYPES.includes(c.discountType as typeof DISCOUNT_TYPES[number])) {
    return 'discountType must be percentage or fixed_amount'
  }
  if (typeof c.discountValue !== 'number' || c.discountValue <= 0) {
    return 'discountValue must be a positive number'
  }
  if (typeof c.expiresInDays !== 'number' || c.expiresInDays < 1 || !Number.isInteger(c.expiresInDays)) {
    return 'expiresInDays must be a positive integer'
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json()

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `type must be one of: ${ALLOWED_TYPES.join(', ')}` }, { status: 400 })
    }
    const hasWaTemplate = body.whatsappTemplateId && typeof body.whatsappTemplateId === 'string'
    if (!hasWaTemplate && (!body.template || typeof body.template !== 'string')) {
      return NextResponse.json({ error: 'template is required when not using a WhatsApp template' }, { status: 400 })
    }
    if (body.couponConfig) {
      const err = validateCouponConfig(body.couponConfig)
      if (err) return NextResponse.json({ error: err }, { status: 400 })
    }
    if (body.status && !ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` }, { status: 400 })
    }

    const campaign = await createCampaign({
      restaurantId,
      name: body.name,
      type: body.type,
      template: body.template || '',
      whatsappTemplateId: body.whatsappTemplateId ?? null,
      couponConfig: body.couponConfig ?? null,
      scheduledAt: body.scheduledAt ?? null,
      schedule: body.schedule ?? null,
      status: body.status ?? 'draft',
    })

    return NextResponse.json(campaign, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Campaign create API error:', error)
    return NextResponse.json(
      { error: 'Failed to create campaign' },
      { status: 500 }
    )
  }
}
