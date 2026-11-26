'use client'

/**
 * BOOK-013 S7: the Today view's data. Today's list (GET /today, capped, R12)
 * and the one search box (name, 4+ phone digits; in the browser over the
 * list, AC-20). The sort (AC-25) lives in the URL (useBookingsPage).
 */
import { useCallback, useEffect, useState } from 'react'
import { fetchToday, type TodayPayload } from './staff-booking-api'

export function useBookingsToday() {
  const [data, setData] = useState<TodayPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')

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

  return { data, failed, loading: data === null && !failed, refetch, query, setQuery }
}

export type BookingsTodayState = ReturnType<typeof useBookingsToday>
