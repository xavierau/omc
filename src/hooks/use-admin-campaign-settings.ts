'use client'

import { useState, useEffect, useCallback } from 'react'

export interface CampaignSettings {
  monthlySendLimit: number
  dailyCampaignLimit: number
  maxUnsubscribeRate: number
  paused?: boolean
  pauseReason?: string | null
}

interface CampaignSettingsResponse {
  settings: CampaignSettings & { restaurantId: string }
  usage: { monthlySends: number; unsubscribeRate: number }
  warnings: string[]
}

export function useAdminCampaignSettings(tenantId: string) {
  const [data, setData] = useState<CampaignSettingsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    if (!tenantId) return
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch(`/api/admin/tenants/${tenantId}/campaign-settings`)
      if (!res.ok) throw new Error('Failed to fetch campaign settings')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  return {
    settings: data?.settings ?? null,
    usage: data?.usage ?? null,
    warnings: data?.warnings ?? [],
    isLoading,
    error,
    refetch: fetchSettings,
  }
}
