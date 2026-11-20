import { NextResponse } from 'next/server'
import { syncTemplateStatus } from '@/application/sync-template-status'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function POST() {
  try {
    const { restaurantId } = await getTenantContext()
    const result = await syncTemplateStatus(restaurantId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Template sync API error:', error)
    return NextResponse.json(
      { error: 'Failed to sync template statuses' },
      { status: 500 }
    )
  }
}
