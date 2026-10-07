import { NextRequest, NextResponse } from 'next/server'
import { merchantRedeemCoupon } from '@/application/merchant-redeem-coupon'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { appendFileSync } from 'fs'

function debugLog(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`
  try { appendFileSync('/tmp/redeem-debug.log', line) } catch {}
  console.error(line)
}

export async function POST(request: NextRequest) {
  try {
    debugLog('POST /api/dashboard/scan/redeem hit')
    const { restaurantId } = await getTenantContext()
    debugLog('tenantContext OK, restaurantId:', restaurantId)
    const body = await request.json()
    const rawCode = typeof body.code === 'string' ? body.code : ''
    const cleanCode = rawCode.replace(/^REDEEM\s+/i, '').trim()
    debugLog('cleanCode:', cleanCode)

    if (!cleanCode) {
      return NextResponse.json(
        { success: false, error: 'invalid_input', message: 'Coupon code is required.' },
        { status: 400 }
      )
    }

    const result = await merchantRedeemCoupon(cleanCode, restaurantId)
    debugLog('merchantRedeemCoupon result:', result)

    if (!result.success) {
      return NextResponse.json(result, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      debugLog('AuthError:', error.message, 'status:', error.statusCode)
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    debugLog('Unhandled error:', {
      name: (error as Error)?.name,
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    })
    return NextResponse.json(
      { success: false, error: 'server_error', message: 'Failed to redeem coupon.' },
      { status: 500 }
    )
  }
}
