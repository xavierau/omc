/**
 * AGENT-001 W2 (R7): the agent conversation log, one row per diner thread
 * over the last 7 days. Tenant admin only; the query is scoped by the
 * session's restaurant in SQL. Phones leave the server masked.
 */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { listAgentLogRowsForRestaurant } from '@/infrastructure/supabase/repositories/agent-conversation-repository'
import { summarizeAgentThreads } from '@/domain/services/agent-conversation-log'

const LOG_DAYS = 7
const MAX_ROWS = 2000

export async function GET() {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const since = new Date(Date.now() - LOG_DAYS * 24 * 3600 * 1000).toISOString()
    const rows = await listAgentLogRowsForRestaurant(ctx.restaurantId, since, MAX_ROWS)
    return NextResponse.json({ threads: summarizeAgentThreads(rows) })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode })
    console.error('[AgentLog] list failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 })
  }
}
