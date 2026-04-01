import { NextRequest, NextResponse } from 'next/server'
import {
  getCampaignById,
  updateCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

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
    return NextResponse.json(campaign)
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
    const allowed = [
      'name', 'template', 'couponConfig',
      'schedule', 'scheduledAt', 'whatsappTemplateId', 'status',
    ]
    const changes: Record<string, unknown> = {}
    for (const key of allowed) {
      if (body[key] !== undefined) changes[key] = body[key]
    }

    const campaign = await updateCampaign(id, changes)
    return NextResponse.json(campaign)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Campaign PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update campaign' },
      { status: 500 }
    )
  }
}
