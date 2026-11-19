'use client'

/**
 * BOOK-001: the dashboard Bookings list and the confirm/decline calls.
 * BOOK-004: the list is fetched for a date range (calendar month / table range).
 * `decideBooking` maps each API answer to what the row shows (spec UI
 * Feedback States): done (+ not-delivered warning), already handled, gone.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTenant } from '@/hooks/use-tenant'
import type { BookingDateRange, BookingRequest } from '@/domain/entities/booking-request'

export type BookingItem = BookingRequest

export type BookingDecisionOutcome =
  | { kind: 'done'; booking: BookingItem; delivered: boolean }
  | { kind: 'already_handled'; status: BookingItem['status'] }
  | { kind: 'not_found' }
  | { kind: 'error' }

export function bookingDecisionOutcome(status: number, body: unknown): BookingDecisionOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as {
    booking?: BookingItem
    delivered?: boolean
    status?: BookingItem['status']
  }
  if (status === 200 && b.booking) return { kind: 'done', booking: b.booking, delivered: b.delivered === true }
  if (status === 409 && b.status) return { kind: 'already_handled', status: b.status }
  if (status === 404) return { kind: 'not_found' }
  return { kind: 'error' }
}

export async function decideBooking(
  id: string,
  decision: 'confirm' | 'decline',
  reason?: string
): Promise<BookingDecisionOutcome> {
  try {
    const res = await fetch(`/api/dashboard/bookings/${encodeURIComponent(id)}/${decision}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision === 'decline' ? { reason: reason ?? '' } : {}),
    })
    return bookingDecisionOutcome(res.status, await res.json().catch(() => null))
  } catch {
    return { kind: 'error' }
  }
}

export interface BookingsPayload {
  bookings: BookingItem[]
  /** Every pending request of the restaurant, any date (BOOK-004). */
  pendingCount: number
  /** The range held more rows than the API returns (BOOK-004 R4). */
  truncated: boolean
}

/** BOOK-004: a date range (inclusive), or r2: every pending booking of any date. */
export type BookingsQuery = BookingDateRange | { status: 'pending' }

const searchOf = (query: BookingsQuery) =>
  new URLSearchParams('status' in query ? { status: query.status } : { from: query.from, to: query.to }).toString()

/** BOOK-004: the bookings the query selects, by date and time. */
export async function fetchBookings(query: BookingsQuery): Promise<BookingsPayload> {
  return fetchBookingsBySearch(searchOf(query))
}

async function fetchBookingsBySearch(search: string): Promise<BookingsPayload> {
  const res = await fetch(`/api/dashboard/bookings?${search}`)
  if (!res.ok) throw new Error('Failed to fetch bookings')
  const body = (await res.json()) as Partial<BookingsPayload> & { bookings: BookingItem[] }
  return { bookings: body.bookings, pendingCount: body.pendingCount ?? 0, truncated: body.truncated === true }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error')

export interface BookingsLanding {
  loaded: (key: string, payload: BookingsPayload) => void
  failed: (key: string, message: string) => void
}

/**
 * A fetch for `forKey` lands only while `forKey` is still the current query
 * (and its effect is still active). Review F2: a decision's refetch can outlive
 * a month change; the old month's answer arriving last must never replace the
 * new month's data, or the page shows Loading forever.
 */
export function bookingsSettler(currentKey: () => string | null, land: BookingsLanding) {
  return (forKey: string, outcome: Promise<BookingsPayload>, isActive: () => boolean = () => true) => {
    const current = () => isActive() && currentKey() === forKey
    return outcome.then(
      (payload) => {
        if (current()) land.loaded(forKey, payload)
      },
      (err) => {
        if (current()) land.failed(forKey, errorText(err))
      }
    )
  }
}

/**
 * `query` null = wait (nothing fetched yet). `data` is only ever the answer
 * for the current query: after a change it is null until that query loads,
 * so a view never shows another range's bookings.
 */
export function useBookings(query: BookingsQuery | null) {
  const { restaurantId } = useTenant()
  const [loaded, setLoaded] = useState<{ key: string; payload: BookingsPayload } | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)
  const key = query ? searchOf(query) : null
  const keyRef = useRef(key)

  const settle = useCallback((forKey: string, outcome: Promise<BookingsPayload>, isActive?: () => boolean) => {
    const land: BookingsLanding = {
      loaded: (k, payload) => {
        setLoaded({ key: k, payload })
        setFailed(null)
      },
      failed: (k, message) => setFailed({ key: k, message }),
    }
    return bookingsSettler(() => keyRef.current, land)(forKey, outcome, isActive)
  }, [])

  // Declared before the fetch effect so it runs first: a fetch always starts with keyRef current.
  useEffect(() => {
    keyRef.current = key
  }, [key])

  useEffect(() => {
    if (!restaurantId || !key) return
    let active = true
    void settle(key, fetchBookingsBySearch(key), () => active)
    return () => {
      active = false
    }
  }, [restaurantId, key, settle])

  // Reloads the query current when it runs, not the one of the render that made it (F2).
  const refetch = useCallback(async () => {
    const current = keyRef.current
    if (!restaurantId || !current) return
    await settle(current, fetchBookingsBySearch(current))
  }, [restaurantId, settle])

  const data = loaded?.key === key ? loaded.payload : null
  const error = failed?.key === key ? failed.message : null
  // The tenant-wide pending count does not depend on the query: keep the last one while a query loads.
  const pendingCount = loaded?.payload.pendingCount ?? 0
  return { data, pendingCount, isLoading: data === null && error === null, error, refetch }
}

export type BookingNotice =
  | { kind: 'sent'; decision: 'confirm' | 'decline' }
  | { kind: 'already_handled'; status: BookingItem['status'] }
  | { kind: 'error' }

/**
 * The notice a decision outcome produces; `already_handled`/`not_found` also refresh the list.
 * A saved decision whose message was not delivered has no notice: the row's
 * "Message not delivered" badge says what happened (spec warning row).
 */
export function noticeFor(decision: 'confirm' | 'decline', outcome: BookingDecisionOutcome): BookingNotice | null {
  if (outcome.kind === 'done') return outcome.delivered ? { kind: 'sent', decision } : null
  if (outcome.kind === 'already_handled') return { kind: 'already_handled', status: outcome.status }
  return { kind: 'error' }
}

export interface DecisionSteps {
  setBusyId: (id: string | null) => void
  decide: typeof decideBooking
  onOutcome: (outcome: BookingDecisionOutcome) => void
  refetch: () => Promise<void>
}

export interface DecisionRequest {
  id: string
  decision: 'confirm' | 'decline'
  reason?: string
}

/** Review F4: the row stays busy until the list has reloaded, so its buttons never re-enable on a row still shown as Pending. */
export async function runDecision(steps: DecisionSteps, { id, decision, reason }: DecisionRequest): Promise<void> {
  steps.setBusyId(id)
  try {
    steps.onOutcome(await steps.decide(id, decision, reason))
    await steps.refetch()
  } finally {
    steps.setBusyId(null)
  }
}

export function useBookingActions(refetch: () => Promise<void>) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<BookingNotice | null>(null)
  const [undelivered, setUndelivered] = useState<ReadonlySet<string>>(new Set())

  async function act(id: string, decision: 'confirm' | 'decline', reason?: string) {
    const onOutcome = (outcome: BookingDecisionOutcome) => {
      setNotice(noticeFor(decision, outcome))
      if (outcome.kind === 'done' && !outcome.delivered) setUndelivered((prev) => new Set(prev).add(id))
    }
    await runDecision({ setBusyId, decide: decideBooking, onOutcome, refetch }, { id, decision, reason })
  }

  return { busyId, notice, undelivered, act }
}
