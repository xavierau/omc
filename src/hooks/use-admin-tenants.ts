'use client'

import { useState, useEffect, useCallback } from 'react'

export interface TenantListItem {
  id: string
  name: string
  slug: string
  phoneNumberId: string | null
  memberCount: number
  status: string
  createdAt: string
}

export interface TenantsResponse {
  tenants: TenantListItem[]
  total: number
  page: number
  limit: number
}

interface UseAdminTenantsParams {
  search?: string
  status?: string
  page?: number
  limit?: number
}

export function useAdminTenants(params: UseAdminTenantsParams = {}) {
  const { search = '', status = '', page = 1, limit = 20 } = params
  const [data, setData] = useState<TenantsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTenants = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const qp = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (search) qp.set('search', search)
      if (status) qp.set('status', status)
      const res = await fetch(`/api/admin/tenants?${qp}`)
      if (!res.ok) throw new Error('Failed to fetch tenants')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [search, status, page, limit])

  useEffect(() => {
    fetchTenants()
  }, [fetchTenants])

  return {
    tenants: data?.tenants ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
    mutate: fetchTenants,
  }
}
