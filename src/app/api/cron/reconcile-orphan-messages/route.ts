import { NextRequest, NextResponse } from 'next/server'
import { reconcileOrphanMessages } from '@/application/reconcile-orphan-messages'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await reconcileOrphanMessages()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[Cron] Orphan reconciliation error:', error)
    return NextResponse.json(
      { error: 'Failed to reconcile orphan messages' },
      { status: 500 }
    )
  }
}
