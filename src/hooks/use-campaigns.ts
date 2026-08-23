'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'
import type { Campaign } from '@/domain/entities/campaign'
import type { CampaignTemplateReviewGate } from '@/components/dashboard/campaign-send-gate'

export type { Campaign }

// Issue #102: the campaigns API is gaining `failureReason` and
// `templateReview` alongside a `status: 'failed'` value (parallel backend
// change, contract only — both fields optional so this reads fine whether or
// not that PR has landed yet). Widening here, not on the domain entity,
// keeps this a presentation-layer concern.
export type DashboardCampaign = Campaign & {
  failureReason?: string | null
  templateReview?: CampaignTemplateReviewGate | null
}

export function useCampaigns() {
  const { restaurantId } = useTenant()
  const [campaigns, setCampaigns] = useState<DashboardCampaign[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCampaigns = useCallback(async () => {
    if (!restaurantId) return
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch('/api/dashboard/campaigns')
      if (!res.ok) throw new Error('Failed to fetch campaigns')
      const json = await res.json()
      setCampaigns(json.campaigns ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  return { campaigns, isLoading, error, refetch: fetchCampaigns }
}
