'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AudienceCounts } from '@/domain/value-objects/audience-query'

const DEBOUNCE_MS = 300

interface Result {
  key: string
  counts: AudienceCounts | null
  error: boolean
}

/**
 * CAMP-016: recipient summary for the campaign form, from the same server-side
 * resolver the send uses. `body` null = nothing to count yet. Debounced and
 * abortable; a result counts only for the request it answers, so an older
 * answer never shows against newer inputs.
 */
export function useAudienceCount(body: Record<string, unknown> | null) {
  const key = body ? JSON.stringify(body) : null
  const [result, setResult] = useState<Result | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch('/api/dashboard/campaigns/audience-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: key,
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`audience-count ${res.status}`)
          return res.json() as Promise<AudienceCounts>
        })
        .then((counts) => setResult({ key, counts, error: false }))
        .catch((e: Error) => e.name !== 'AbortError' && setResult({ key, counts: null, error: true }))
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, attempt])

  const current = key && result?.key === key ? result : null
  const retry = useCallback(() => { setResult(null); setAttempt((n) => n + 1) }, [])
  return { counts: current?.counts ?? null, loading: !!key && !current, error: current?.error ?? false, retry }
}
