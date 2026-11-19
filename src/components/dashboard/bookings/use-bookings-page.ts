'use client'

/**
 * BOOK-004: the Bookings page state: view (`?view=` > localStorage >
 * calendar), the selected day, the table range, status filter and search
 * (search stays in memory, never in the URL: R6), and the dates to fetch.
 */
import { useState, useSyncExternalStore } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { todayInHongKong } from './booking-dates'
import type { StatusFilter } from './booking-groups'
import {
  fetchRange,
  readStoredView,
  resolveView,
  SHOW_PENDING,
  stepSelected,
  storeView,
  type BookingsView,
  type TableRange,
} from './bookings-view-state'
import { useIsPhone } from './use-media'

function subscribeStorage(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

export function useBookingsPage() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const stored = useSyncExternalStore(subscribeStorage, readStoredView, () => null)
  const view = resolveView(params.get('view'), stored)
  const isPhone = useIsPhone()
  const today = todayInHongKong()
  const [selected, setSelected] = useState(today)
  const [tableRange, setTableRange] = useState<TableRange>('upcoming')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')

  const setView = (next: BookingsView) => {
    storeView(next)
    router.replace(`${pathname}?view=${next}`, { scroll: false })
  }

  return {
    view, isPhone, today, selected, tableRange, status, query,
    range: fetchRange(view, selected, tableRange, today),
    setView, setStatus, setQuery, setTableRange,
    select: setSelected,
    shift: (direction: 1 | -1) => setSelected((s) => stepSelected(s, direction, isPhone, today)),
    goToday: () => setSelected(today),
    showPending: () => {
      setStatus(SHOW_PENDING.status)
      setTableRange(SHOW_PENDING.tableRange)
      setView(SHOW_PENDING.view)
    },
  }
}
