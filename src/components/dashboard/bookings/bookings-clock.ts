'use client'

/**
 * BOOK-007 r1 F5: the Bookings page's "now", ticking on each minute boundary,
 * so a confirmed booking whose time passes while the page is open gets its
 * Mark no-show action without a refetch. One timer for the screen, cleared on
 * unmount. Hong Kong has no DST, so its minutes start with UTC's.
 */
import { createContext, useEffect, useState } from 'react'

const MINUTE = 60_000

/** Calls `onTick` with the time at each minute boundary; returns the stop function. */
export function startMinuteTick(onTick: (now: Date) => void): () => void {
  let handle: ReturnType<typeof setTimeout>
  const arm = () => {
    handle = setTimeout(() => {
      onTick(new Date())
      arm()
    }, MINUTE - (Date.now() % MINUTE))
  }
  arm()
  return () => clearTimeout(handle)
}

export function useMinuteTick(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => startMinuteTick(setNow), [])
  return now
}

/** The screen's ticking now; null outside the Bookings screen (the reader then uses the time it renders at). */
export const BookingsNow = createContext<Date | null>(null)
