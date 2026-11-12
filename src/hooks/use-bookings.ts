'use client'

/**
 * BOOK-001: the dashboard Bookings list and the confirm/decline calls.
 * `decideBooking` maps each API answer to what the row shows (spec UI
 * Feedback States): done (+ not-delivered warning), already handled, gone.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '@/hooks/use-tenant'
import type { BookingRequest } from '@/domain/entities/booking-request'

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

export async function fetchBookings(): Promise<BookingItem[]> {
  const res = await fetch('/api/dashboard/bookings')
  if (!res.ok) throw new Error('Failed to fetch bookings')
  return ((await res.json()) as { bookings: BookingItem[] }).bookings
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error')

export function useBookings() {
  const { restaurantId } = useTenant()
  const [data, setData] = useState<BookingItem[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!restaurantId) return
    setIsLoading(true)
    try {
      setData(await fetchBookings())
      setError(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setIsLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    if (!restaurantId) return
    let active = true
    fetchBookings().then(
      (bookings) => {
        if (!active) return
        setData(bookings)
        setIsLoading(false)
      },
      (err) => {
        if (!active) return
        setError(errorText(err))
        setIsLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [restaurantId])

  return { data, isLoading, error, refetch }
}

export type BookingNotice =
  | { kind: 'sent'; decision: 'confirm' | 'decline' }
  | { kind: 'already_handled'; status: BookingItem['status'] }
  | { kind: 'error' }

/** The notice a decision outcome produces; `already_handled`/`not_found` also refresh the list. */
export function noticeFor(decision: 'confirm' | 'decline', outcome: BookingDecisionOutcome): BookingNotice {
  if (outcome.kind === 'done') return { kind: 'sent', decision }
  if (outcome.kind === 'already_handled') return { kind: 'already_handled', status: outcome.status }
  return { kind: 'error' }
}

export function useBookingActions(refetch: () => Promise<void>) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<BookingNotice | null>(null)
  const [undelivered, setUndelivered] = useState<ReadonlySet<string>>(new Set())

  async function act(id: string, decision: 'confirm' | 'decline', reason?: string) {
    setBusyId(id)
    const outcome = await decideBooking(id, decision, reason)
    setNotice(noticeFor(decision, outcome))
    if (outcome.kind === 'done' && !outcome.delivered) setUndelivered((prev) => new Set(prev).add(id))
    setBusyId(null)
    await refetch()
  }

  return { busyId, notice, undelivered, act }
}
