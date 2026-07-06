import { NextRequest, NextResponse } from 'next/server'
import { registerMemberWeb } from '@/application/register-member-web'
import { findBySlug } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { isTenantAccessible } from '@/domain/services/trial-status'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const restaurant = await findBySlug(slug)
    if (!restaurant) {
      return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })
    }

    const accessible = isTenantAccessible({
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      whatsappNumber: '',
      kapsoPhoneNumberId: restaurant.kapso_phone_number_id,
      metaBusinessAccountId: restaurant.meta_business_account_id,
      status: restaurant.status,
      plan: (restaurant.plan as 'starter' | 'growth' | 'pro') ?? 'starter',
      trialExpiresAt: restaurant.trial_expires_at,
      referrerId: restaurant.referrer_id ?? null,
      redirectNumber: restaurant.redirect_number ?? null,
      redirectLabel: restaurant.redirect_label ?? 'Contact us',
      createdAt: '',
    })

    if (!accessible) {
      return NextResponse.json(
        { error: 'tenant_unavailable', message: 'Contact us to continue' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { phone, name } = body

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid phone' }, { status: 400 })
    }
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid name' }, { status: 400 })
    }

    // The welcome campaign is now resolved from the restaurant's mapping
    // (see restaurants.welcome_campaign_id), NOT from the QR's query string.
    const result = await registerMemberWeb(phone, name, restaurant.id)

    if (result.isNew) {
      return NextResponse.json({ couponCode: result.couponCode })
    }

    return NextResponse.json({ existing: true })
  } catch (error) {
    const message = (error as Error).message ?? ''
    console.error('Join error:', message)

    if (message.includes('Invalid phone')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}
