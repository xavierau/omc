'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'

export interface Member {
  id: string
  phone: string
  name: string | null
  points_balance: number
  status: string
  joined_at: string
  last_visit_at: string | null
}

export interface MembersResponse {
  members: Member[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface UseMembersParams {
  search?: string
  page?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export function useMembers(params: UseMembersParams = {}) {
  const { search = '', page = 1, sortBy = 'last_visit_at', sortOrder = 'desc' } = params
  const { restaurantId } = useTenant()
  const [data, setData] = useState<MembersResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMembers = useCallback(async () => {
    if (!restaurantId) return
    try {
      setIsLoading(true)
      setError(null)
      const queryParams = new URLSearchParams({
        page: String(page),
        sortBy,
        sortOrder,
      })
      if (search) queryParams.set('search', search)

      const res = await fetch(`/api/dashboard/members?${queryParams}`)
      if (!res.ok) throw new Error('Failed to fetch members')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [page, search, sortBy, sortOrder, restaurantId])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  return { data, isLoading, error, refetch: fetchMembers }
}
