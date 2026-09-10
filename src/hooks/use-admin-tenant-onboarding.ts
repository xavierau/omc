'use client'

import { useState, useEffect, useCallback } from 'react'
import type { OnboardingPath } from '@/domain/value-objects/onboarding-path'
import type { ChecklistKey } from '@/domain/value-objects/pre-kickoff-checklist'
import type {
  BlockedReason,
  KpiGateView,
  OnboardingStateView,
} from '@/application/onboarding/get-onboarding-state'

export type { BlockedReason, KpiGateView, OnboardingStateView }

type SubRoute = 'path' | 'checklist' | 'advance'

export function buildOnboardingUrl(tenantId: string, sub?: SubRoute): string {
  const base = `/api/admin/tenants/${tenantId}/onboarding`
  return sub ? `${base}/${sub}` : base
}

export function parsePathRequest(path: OnboardingPath) {
  return { path }
}

export function parseChecklistRequest(key: ChecklistKey, checked: boolean) {
  return { key, checked }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

interface HookResult {
  view: OnboardingStateView | null
  isLoading: boolean
  error: string | null
  setPath: (path: OnboardingPath) => Promise<boolean>
  updateChecklistItem: (key: ChecklistKey, checked: boolean) => Promise<boolean>
  advancePhase: () => Promise<boolean>
}

export function useAdminTenantOnboarding(tenantId: string): HookResult {
  const [view, setView] = useState<OnboardingStateView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!tenantId) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(buildOnboardingUrl(tenantId))
      if (!res.ok) throw new Error('Failed to load onboarding state')
      setView((await res.json()) as OnboardingStateView)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const mutateThenRefresh = useCallback(
    async (url: string, init: RequestInit): Promise<boolean> => {
      try {
        const res = await fetch(url, init)
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          const reason = body?.reason ?? body?.error ?? 'Request failed'
          setError(String(reason))
          return false
        }
        await refresh()
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed')
        return false
      }
    },
    [refresh]
  )

  const setPath = useCallback(
    (path: OnboardingPath) =>
      mutateThenRefresh(buildOnboardingUrl(tenantId, 'path'), {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(parsePathRequest(path)),
      }),
    [mutateThenRefresh, tenantId]
  )

  const updateChecklistItem = useCallback(
    (key: ChecklistKey, checked: boolean) =>
      mutateThenRefresh(buildOnboardingUrl(tenantId, 'checklist'), {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(parseChecklistRequest(key, checked)),
      }),
    [mutateThenRefresh, tenantId]
  )

  const advancePhase = useCallback(
    () =>
      mutateThenRefresh(buildOnboardingUrl(tenantId, 'advance'), {
        method: 'POST',
      }),
    [mutateThenRefresh, tenantId]
  )

  return { view, isLoading, error, setPath, updateChecklistItem, advancePhase }
}
