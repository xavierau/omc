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
  tags?: { id: string; name: string; color: string }[]
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
  tagId?: string
}

interface MembersQueryParams {
  page: number
  sortBy: string
  sortOrder: string
  search?: string
  tagId?: string
}

export function buildMembersQuery(params: MembersQueryParams): string {
  const queryParams = new URLSearchParams({
    page: String(params.page),
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  })
  if (params.search) queryParams.set('search', params.search)
  if (params.tagId) queryParams.set('tagId', params.tagId)
  return queryParams.toString()
}

export function useMembers(params: UseMembersParams = {}) {
  const { search = '', page = 1, sortBy = 'last_visit_at', sortOrder = 'desc', tagId } = params
  const { restaurantId } = useTenant()
  const [data, setData] = useState<MembersResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMembers = useCallback(async () => {
    if (!restaurantId) return
    try {
      setIsLoading(true)
      setError(null)
      const query = buildMembersQuery({ page, sortBy, sortOrder, search, tagId })

      const res = await fetch(`/api/dashboard/members?${query}`)
      if (!res.ok) throw new Error('Failed to fetch members')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [page, search, sortBy, sortOrder, tagId, restaurantId])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  return { data, isLoading, error, refetch: fetchMembers }
}
