import { createServerSupabaseClient } from './client'

interface AuditLogParams {
  userId: string
  action: string
  resourceType: string
  resourceId?: string
  details?: Record<string, unknown>
  ipAddress?: string
}

export function logAdminAction(params: AuditLogParams): void {
  const supabase = createServerSupabaseClient()

  void supabase
    .from('admin_audit_logs')
    .insert({
      user_id: params.userId,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId ?? null,
      details: params.details ?? null,
      ip_address: params.ipAddress ?? null,
    })
    .then(({ error }) => {
      if (error) console.error('Audit log insert failed:', error)
    })
}

export function extractIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}
