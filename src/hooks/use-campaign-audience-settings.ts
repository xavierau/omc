'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SkipContactQuality } from '@/domain/value-objects/audience-filters'

const ENDPOINT = '/api/dashboard/settings/campaigns'

export interface CampaignAudienceSettings {
  skipContactQuality: SkipContactQuality
  lapsedAfterDays: number
  thresholds: { greenPercent: number; yellowPercent: number; windowDays: number }
  canEdit: boolean
}

/**
 * CAMP-016: the tenant's campaign audience defaults (Settings → Campaigns,
 * campaign form pre-fill). `onLoad` runs with each loaded value, from the
 * fetch callback (not an effect body).
 */
export function useCampaignAudienceSettings(enabled = true, onLoad?: (s: CampaignAudienceSettings) => void) {
  const [settings, setSettings] = useState<CampaignAudienceSettings | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const onLoadRef = useRef(onLoad)
  useEffect(() => { onLoadRef.current = onLoad })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetch(ENDPOINT, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`campaign settings ${res.status}`)
        return res.json() as Promise<CampaignAudienceSettings>
      })
      .then((s) => { setSettings(s); setError(false); onLoadRef.current?.(s) })
      .catch((e: Error) => e.name !== 'AbortError' && setError(true))
    return () => controller.abort()
  }, [enabled, attempt])

  const reload = useCallback(() => { setError(false); setAttempt((n) => n + 1) }, [])
  return { settings, loading: enabled && !settings && !error, error, reload }
}

export async function saveCampaignAudienceSettings(body: {
  skipContactQuality: SkipContactQuality
  lapsedAfterDays: number
}): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`save failed (${res.status})`)
}
