'use client'

/**
 * BOOK-013 S7: the Today view's data. Today's list (GET /today, capped, R12),
 * the one search box (name, 4+ phone digits, code; in the browser over the
 * list, AC-20), a full code typed or scanned looked up on the server inside
 * this restaurant (AC-21, AC-24, strict parse R15), and the scan sheet.
 */
import { useCallback, useEffect, useState } from 'react'
import { parseCheckinCode } from '@/domain/services/booking-checkin'
import { fetchToday, lookupCode, type CodeLookup, type TodayPayload } from './staff-booking-api'

export type ScanState =
  | { kind: 'closed' }
  | { kind: 'scanning' }
  | { kind: 'camera_denied' }
  | { kind: 'looking' }
  | { kind: 'result'; lookup: CodeLookup }

export function useBookingsToday() {
  const [data, setData] = useState<TodayPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [codeCard, setCodeCard] = useState<CodeLookup | null>(null)
  const [scan, setScan] = useState<ScanState>({ kind: 'closed' })

  const refetch = useCallback(async () => {
    const next = await fetchToday()
    setFailed(next === null)
    if (next) setData(next)
  }, [])

  useEffect(() => {
    let live = true
    fetchToday().then((next) => {
      if (!live) return
      setFailed(next === null)
      if (next) setData(next)
    })
    return () => {
      live = false
    }
  }, [])

  // A whole code in the search box opens its booking (any date, this restaurant only).
  useEffect(() => {
    const code = parseCheckinCode(query)
    if (!code) return
    let live = true
    lookupCode(code).then((found) => live && setCodeCard(found))
    return () => {
      live = false
    }
  }, [query])

  async function onScanned(text: string) {
    if (text === '') return setScan({ kind: 'camera_denied' })
    const code = parseCheckinCode(text)
    if (!code) return setScan({ kind: 'result', lookup: { kind: 'not_found' } })
    setScan({ kind: 'looking' })
    setScan({ kind: 'result', lookup: await lookupCode(code) })
  }

  return {
    data,
    failed,
    loading: data === null && !failed,
    refetch,
    query,
    setQuery,
    codeCard: parseCheckinCode(query) ? codeCard : null,
    scan,
    openScan: () => setScan({ kind: 'scanning' }),
    scanAgain: () => setScan({ kind: 'scanning' }),
    closeScan: () => setScan({ kind: 'closed' }),
    onScanned,
  }
}

export type BookingsTodayState = ReturnType<typeof useBookingsToday>
