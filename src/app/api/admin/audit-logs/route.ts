import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const params = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(params.get('page') ?? '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10)))
    const action = params.get('action')
    const resourceType = params.get('resourceType')

    const { data, count } = await queryAuditLogs({
      page, limit, action, resourceType,
    })

    const logs = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: row.details,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    }))

    return NextResponse.json({
      logs,
      total: count ?? 0,
      page,
      limit,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Audit log query error:', error)
    return NextResponse.json({ error: 'Failed to load audit logs' }, { status: 500 })
  }
}

interface QueryParams {
  page: number
  limit: number
  action: string | null
  resourceType: string | null
}

async function queryAuditLogs(params: QueryParams) {
  const supabase = createServerSupabaseClient()
  const offset = (params.page - 1) * params.limit

  let query = supabase
    .from('admin_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + params.limit - 1)

  if (params.action) {
    query = query.eq('action', params.action)
  }
  if (params.resourceType) {
    query = query.eq('resource_type', params.resourceType)
  }

  return query
}
