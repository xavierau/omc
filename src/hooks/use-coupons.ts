'use client'

import { useState, useEffect, useCallback } from 'react'

export interface CouponListItem {
  id: string
  code: string
  type: 'welcome' | 'promo' | 'reward' | 'shared'
  status: 'active' | 'redeemed' | 'expired'
  discountType: 'percentage' | 'fixed_amount' | null
  discountValue: number | null
  maxUses: number | null
  currentUses: number
  isActive: boolean
  expiresAt: string | null
  description: string | null
  createdAt: string
}

export interface CouponsResponse {
  coupons: CouponListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface UseCouponsParams {
  type?: string
  active?: string
  page?: number
}

export function useCoupons(params: UseCouponsParams = {}) {
  const { type = '', active = '', page = 1 } = params
  const [data, setData] = useState<CouponsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCoupons = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const queryParams = new URLSearchParams({ page: String(page) })
      if (type) queryParams.set('type', type)
      if (active) queryParams.set('isActive', active)

      const res = await fetch(`/api/dashboard/coupons?${queryParams}`)
      if (!res.ok) throw new Error('Failed to fetch coupons')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [page, type, active])

  useEffect(() => {
    fetchCoupons()
  }, [fetchCoupons])

  return { data, isLoading, error, refetch: fetchCoupons }
}
