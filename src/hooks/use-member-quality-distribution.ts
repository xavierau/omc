'use client'

import { useCallback, useEffect, useState } from 'react'

export interface MemberQualityDistribution {
  total: number
  green: number
  yellow: number
  red: number
  noData: number
}

/** CAMP-016: active-member quality counts for the Settings → Campaigns bar (aggregates only). */
export function useMemberQualityDistribution() {
  const [data, setData] = useState<MemberQualityDistribution | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/dashboard/settings/campaigns/quality', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`quality ${res.status}`)
        return res.json() as Promise<MemberQualityDistribution>
      })
      .then(setData)
      .catch((e: Error) => e.name !== 'AbortError' && setError(true))
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => { setError(false); setData(null); setAttempt((n) => n + 1) }, [])
  return { data, loading: !data && !error, error, retry }
}
