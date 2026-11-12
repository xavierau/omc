import { NextRequest, NextResponse } from 'next/server'
import { getActiveTemplate } from '@/infrastructure/supabase/repositories/layout-template-repository'
import { buildReceiptTemplate } from '@/application/build-receipt-template'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const result = await getActiveTemplate(restaurantId)

    if (!result) {
      return NextResponse.json({ template: null })
    }

    return NextResponse.json({
      template: result.template_json,
      threshold: result.threshold,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Templates GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json()
    const imageUrls: string[] = body.imageUrls

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return NextResponse.json({ error: 'imageUrls array is required' }, { status: 400 })
    }

    const result = await buildReceiptTemplate({ restaurantId, imageUrls })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Failed to build template'
    const status = message.includes('Expected') ? 400 : 500
    console.error('Templates POST error:', error)
    return NextResponse.json({ error: message }, { status })
  }
}
