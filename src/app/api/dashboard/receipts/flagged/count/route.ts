// CAMP-016 r3: the "N flagged" pill on Settings → Receipts. A head count of
// the session tenant's flagged receipts: no rows, image URLs or phones.
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { countFlaggedReceipts } from '@/infrastructure/supabase/repositories/receipt-repository'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    return NextResponse.json({ count: await countFlaggedReceipts(restaurantId) })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Flagged receipts count error:', error)
    return NextResponse.json({ error: 'Failed to count flagged receipts' }, { status: 500 })
  }
}
