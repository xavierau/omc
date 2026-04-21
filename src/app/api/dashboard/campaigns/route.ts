import { NextRequest, NextResponse } from 'next/server'
import {
  listCampaigns,
  createCampaign,
  setCampaignMembers,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { parseCreateBody, CampaignBodyError } from './parse-create-body'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const campaigns = await listCampaigns(restaurantId)
    return NextResponse.json({ campaigns })
  } catch (error) {
    return handleError(error, 'Campaigns API error', 'Failed to load campaigns')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = (await request.json()) as Record<string, unknown>
    const parsed = parseCreateBody(body)

    const campaign = await createCampaign({
      restaurantId,
      name: parsed.name,
      type: parsed.type,
      template: parsed.template,
      templateEn: parsed.templateEn,
      templateZhHk: parsed.templateZhHk,
      whatsappTemplateId: parsed.whatsappTemplateId,
      couponConfig:
        parsed.couponConfig as unknown as Parameters<
          typeof createCampaign
        >[0]['couponConfig'],
      scheduledAt: parsed.scheduledAt,
      schedule: parsed.schedule,
      status: parsed.status,
      targetAudience: parsed.targetAudience,
    })

    if (parsed.targetAudience === 'selected') {
      await setCampaignMembers(campaign.id, parsed.memberIds)
    }

    return NextResponse.json(campaign, { status: 201 })
  } catch (error) {
    return handleError(error, 'Campaign create API error', 'Failed to create campaign')
  }
}

function handleError(error: unknown, logLabel: string, defaultMsg: string) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  if (error instanceof CampaignBodyError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error(`${logLabel}:`, error)
  return NextResponse.json({ error: defaultMsg }, { status: 500 })
}
