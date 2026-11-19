/**
 * AGENT-001 W2 (R7): one diner thread of the agent conversation log.
 *
 * The key is a row id, resolved to the phone only inside the session's
 * restaurant (another tenant's key → 404, the same as an unknown one). The
 * response carries the masked phone only.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import {
  findAgentThreadPhoneForRestaurant,
  listAgentThreadMessagesForRestaurant,
} from '@/infrastructure/supabase/repositories/agent-conversation-repository'
import { isAgentThreadKey, maskAgentPhone } from '@/domain/services/agent-conversation-log'

const MAX_MESSAGES = 200
const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

export async function GET(_request: NextRequest, { params }: { params: Promise<{ threadKey: string }> }) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const { threadKey } = await params
    if (!isAgentThreadKey(threadKey)) return notFound()
    const phone = await findAgentThreadPhoneForRestaurant(ctx.restaurantId, threadKey)
    if (!phone) return notFound()
    const messages = await listAgentThreadMessagesForRestaurant(ctx.restaurantId, phone, MAX_MESSAGES)
    return NextResponse.json({ thread: { key: threadKey, maskedPhone: maskAgentPhone(phone) }, messages })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode })
    console.error('[AgentLog] thread failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
  }
}
