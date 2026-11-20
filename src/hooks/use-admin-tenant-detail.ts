'use client'

import { useState, useEffect, useCallback } from 'react'

export interface TenantDetail {
  id: string
  name: string
  slug: string
  whatsappNumber: string
  kapsoPhoneNumberId: string
  metaBusinessAccountId: string | null
  plan: 'starter' | 'growth' | 'pro'
  status: 'active' | 'inactive' | 'trial'
  trialExpiresAt: string | null
  createdAt: string
  referrerId: string | null
}

export interface TenantUser {
  id: string
  email: string
  role: string
  createdAt: string
}

export interface TenantMetrics {
  memberCount: number
  receiptCount: number
  couponRedemptions: number
}

interface TenantDetailResponse {
  tenant: TenantDetail
  users: TenantUser[]
  metrics: TenantMetrics
}

export function useAdminTenantDetail(tenantId: string) {
  const [data, setData] = useState<TenantDetailResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDetail = useCallback(async () => {
    if (!tenantId) return
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch(`/api/admin/tenants/${tenantId}`)
      if (!res.ok) throw new Error('Failed to fetch tenant')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  return {
    tenant: data?.tenant ?? null,
    users: data?.users ?? [],
    metrics: data?.metrics ?? null,
    isLoading,
    error,
    mutate: fetchDetail,
  }
}
