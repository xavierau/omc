'use client'

import { useState, useEffect, useCallback } from 'react'

export interface ReferrerListItem {
  id: string
  name: string
  contactEmail: string
  contactPhone: string | null
  commissionPerMessageHkd: number
  status: string
  createdAt: string
}

interface UseAdminReferrersParams {
  status?: string
}

export function useAdminReferrers(params: UseAdminReferrersParams = {}) {
  const { status = '' } = params
  const [referrers, setReferrers] = useState<ReferrerListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReferrers = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const qp = new URLSearchParams()
      if (status) qp.set('status', status)
      const res = await fetch(`/api/admin/referrers?${qp}`)
      if (!res.ok) throw new Error('Failed to fetch referrers')
      const json = await res.json()
      setReferrers(json.referrers ?? json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [status])

  useEffect(() => { fetchReferrers() }, [fetchReferrers])

  return { referrers, isLoading, error, mutate: fetchReferrers }
}
