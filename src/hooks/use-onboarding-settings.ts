'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  OnboardingSettings,
  OnboardingPatch,
} from '@/domain/onboarding/onboarding-settings'
import {
  fetchOnboardingSettings,
  patchOnboardingSettings,
} from '@/hooks/onboarding-settings-api'

export type { OnboardingSettings, OnboardingPatch }

export function useOnboardingSettings() {
  const [settings, setSettings] = useState<OnboardingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchOnboardingSettings()
      setSettings(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const saveSettings = useCallback(async (patch: OnboardingPatch) => {
    setSaving(true)
    setError(null)
    try {
      const updated = await patchOnboardingSettings(patch)
      setSettings(updated)
      return updated
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      throw err
    } finally {
      setSaving(false)
    }
  }, [])

  return { settings, loading, saving, error, saveSettings, refetch: load }
}
