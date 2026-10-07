'use client'

import { useState, useCallback } from 'react'
import { postStamp, lookupMemberByPhone } from './give-stamp-client'

// Unified outcome surfaced to the StampResultCard. The first three come from the
// apply_stamp RPC; the last two are server error bodies normalized into outcomes.
export type StampOutcome =
  | 'stamped'
  | 'already_stamped_today'
  | 'completed'
  | 'no_active_campaign'
  | 'not_resolved'

export interface StampResult {
  outcome: StampOutcome
  stampsCount: number
  stampsRequired: number
  completed: boolean
}

export type GiveStampState = 'idle' | 'confirm' | 'result'

interface UseGiveStamp {
  state: GiveStampState
  loading: boolean
  result: StampResult | null
  phoneLookupFailed: boolean
  onDecode: (rawScan: string) => void
  confirmGive: () => Promise<void>
  lookupByPhone: (phone: string) => Promise<void>
  reset: () => void
}

export function useGiveStamp(): UseGiveStamp {
  const [state, setState] = useState<GiveStampState>('idle')
  const [rawScan, setRawScan] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<StampResult | null>(null)
  const [phoneLookupFailed, setPhoneLookupFailed] = useState(false)

  const reset = useCallback(() => {
    setState('idle')
    setRawScan('')
    setResult(null)
    setPhoneLookupFailed(false)
  }, [])

  // A successful decode in Give-Stamp mode goes to the one-tap confirm screen.
  // We keep the payload UN-STRIPPED so the server resolver sees the prefix.
  const onDecode = useCallback((scan: string) => {
    if (!scan.trim()) return
    setRawScan(scan)
    setResult(null)
    setPhoneLookupFailed(false)
    setState('confirm')
  }, [])

  const confirmGive = useCallback(async () => {
    setLoading(true)
    setResult(await postStamp({ rawScan }))
    setLoading(false)
    setState('result')
  }, [rawScan])

  const lookupByPhone = useCallback(async (phone: string) => {
    setLoading(true)
    setPhoneLookupFailed(false)
    const found = await lookupMemberByPhone(phone)
    if (!found) {
      setPhoneLookupFailed(true)
      setLoading(false)
      return
    }
    setResult(await postStamp({ memberId: found }))
    setLoading(false)
    setState('result')
  }, [])

  return {
    state,
    loading,
    result,
    phoneLookupFailed,
    onDecode,
    confirmGive,
    lookupByPhone,
    reset,
  }
}
