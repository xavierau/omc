'use client'

import { useState, useEffect, useCallback } from 'react'

export type ViolationKey =
  | 'quality_not_green'
  | 'empty_audience'
  | 'daily_cap_met'
  | 'auto_paused'

export interface PreflightViolation {
  key: ViolationKey
  detail?: string
}

export interface ReconfirmationTemplatePreview {
  id: string
  name: string
  bodyEn?: string
  bodyZhHk?: string
}

export interface ReconfirmationAudienceSampleRow {
  phoneE164: string
  capturedAt: string
}

export interface ReconfirmationPreflightResult {
  allowed: boolean
  violations: PreflightViolation[]
  audienceCount: number
  currentDailySent: number
  cap: number
  templatePreview?: ReconfirmationTemplatePreview
  audienceSample?: ReconfirmationAudienceSampleRow[]
}

export function buildReconfirmationPreflightUrl(): string {
  return '/api/dashboard/campaigns/reconfirmation/preflight'
}

export interface UseReconfirmationPreflightResult {
  data: ReconfirmationPreflightResult | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Subscribes to the preflight endpoint. The effect bumps a tick counter to
 * re-fire the fetch on `refetch()`. setState happens only in the resolved
 * promise callbacks (not synchronously in the effect body), avoiding the
 * `react-hooks/set-state-in-effect` rule.
 */
export function useReconfirmationPreflight(): UseReconfirmationPreflightResult {
  const [data, setData] = useState<ReconfirmationPreflightResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(async (): Promise<void> => {
    setTick((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(buildReconfirmationPreflightUrl())
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load preflight')
        return (await res.json()) as ReconfirmationPreflightResult
      })
      .then((json) => { if (!cancelled) { setData(json); setError(null) } })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unknown error')
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [tick])

  return { data, isLoading, error, refetch }
}
