'use client'

import { useState, useEffect, useCallback } from 'react'

export interface AuditLogItem {
  id: string
  userId: string
  action: string
  resourceType: string
  resourceId: string
  details: Record<string, unknown> | null
  ipAddress: string
  createdAt: string
}

export interface AuditLogsResponse {
  logs: AuditLogItem[]
  total: number
  page: number
  limit: number
}

interface UseAdminAuditLogsParams {
  page?: number
  limit?: number
  action?: string
  resourceType?: string
}

export function useAdminAuditLogs(params: UseAdminAuditLogsParams = {}) {
  const { page = 1, limit = 20, action = '', resourceType = '' } = params
  const [data, setData] = useState<AuditLogsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const qp = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (action) qp.set('action', action)
      if (resourceType) qp.set('resourceType', resourceType)
      const res = await fetch(`/api/admin/audit-logs?${qp}`)
      if (!res.ok) throw new Error('Failed to fetch audit logs')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [page, limit, action, resourceType])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  return {
    logs: data?.logs ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
    mutate: fetchLogs,
  }
}
