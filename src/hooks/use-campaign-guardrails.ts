'use client'

import { useState, useEffect, useCallback } from 'react'

export interface GuardrailUsage {
  monthlySends: number
  monthlyLimit: number
  dailyCampaigns: number
  dailyLimit: number
  unsubscribeRate: number
  maxRate: number
}

export interface GuardrailStatus {
  allowed: boolean
  violations: string[]
  warnings: string[]
  usage: GuardrailUsage
}

export function useCampaignGuardrails() {
  const [data, setData] = useState<GuardrailStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchGuardrails = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/dashboard/campaigns/guardrails')
      if (!res.ok) throw new Error('Failed to fetch guardrails')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchGuardrails()
  }, [fetchGuardrails])

  return { data, loading, error, refetch: fetchGuardrails }
}
