'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'
import type { ContactQuality } from '@/domain/value-objects/contact-quality'

export interface Member {
  id: string
  phone: string
  name: string | null
  points_balance: number
  status: string
  joined_at: string
  last_visit_at: string | null
  tags?: { id: string; name: string; color: string }[]
  quality?: ContactQuality
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
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  tagId?: string
  /** Ask the API for per-member delivery quality (costly; only the members page shows it). */
  includeQuality?: boolean
}

interface MembersQueryParams {
  page: number
  pageSize?: number
  sortBy: string
  sortOrder: string
  search?: string
  tagId?: string
  includeQuality?: boolean
}

export function buildMembersQuery(params: MembersQueryParams): string {
  const queryParams = new URLSearchParams({
    page: String(params.page),
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  })
  if (params.pageSize) queryParams.set('pageSize', String(params.pageSize))
  if (params.search) queryParams.set('search', params.search)
  if (params.tagId) queryParams.set('tagId', params.tagId)
  if (params.includeQuality) queryParams.set('include', 'quality')
  return queryParams.toString()
}

export function useMembers(params: UseMembersParams = {}) {
  const { search = '', page = 1, pageSize, sortBy = 'last_visit_at', sortOrder = 'desc', tagId, includeQuality = false } = params
  const { restaurantId } = useTenant()
  const [data, setData] = useState<MembersResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMembers = useCallback(async () => {
    if (!restaurantId) return null
    try {
      setIsLoading(true)
      setError(null)
      const query = buildMembersQuery({ page, pageSize, sortBy, sortOrder, search, tagId, includeQuality })

      const res = await fetch(`/api/dashboard/members?${query}`)
      if (!res.ok) throw new Error('Failed to fetch members')
      const json = await res.json()
      setData(json)
      return json as MembersResponse
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, search, sortBy, sortOrder, tagId, includeQuality, restaurantId])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  return { data, isLoading, error, refetch: fetchMembers }
}
