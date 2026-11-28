import { NextRequest, NextResponse } from 'next/server'
import { findPosTransactionsByRestaurant } from '@/infrastructure/supabase/repositories/pos-transaction-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const { searchParams } = request.nextUrl
    const limit = parseInt(searchParams.get('limit') ?? '50', 10)
    const offset = parseInt(searchParams.get('offset') ?? '0', 10)

    const transactions = await findPosTransactionsByRestaurant(restaurantId, { limit, offset })
    return NextResponse.json({ data: transactions })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('POS transactions list error:', error)
    return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 })
  }
}
