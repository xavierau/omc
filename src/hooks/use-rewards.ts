'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'

export interface RewardItem {
  id: string
  restaurantId: string
  name: string
  pointsCost: number
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  couponExpiryDays: number
  isActive: boolean
  sortOrder: number
}

export function useRewards() {
  const { restaurantId } = useTenant()
  const [data, setData] = useState<RewardItem[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRewards = useCallback(async () => {
    if (!restaurantId) return
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch('/api/dashboard/rewards')
      if (!res.ok) throw new Error('Failed to fetch rewards')
      const json = await res.json()
      setData(json.rewards)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    fetchRewards()
  }, [fetchRewards])

  return { data, isLoading, error, refetch: fetchRewards }
}
