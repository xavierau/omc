'use client'

/**
 * BOOK-010 (spec S3, AC-8, AC-9, UI Feedback States): the Bookings
 * calendar's capacity data and the stop / resume calls, on W1's APIs:
 * `GET /api/dashboard/bookings/capacity?date` (the day panel block),
 * `?from&to` (month badges), `POST` / `DELETE /api/dashboard/bookings/stops`.
 * A switch flips at once; when the call fails it flips back and the block
 * says "Couldn't update. Try again."; on success both reads reload.
 */
import { useCallback, useEffect, useState } from 'react'
import type { DayCapacityBody } from '@/application/booking/booking-capacity'
import type { CapacityBadge, CapacityPeriod } from '@/domain/services/booking-capacity'
import type { StopTarget } from '@/domain/services/booking-room'
import type { BookingItem } from '@/hooks/use-bookings'

export type CapacityDayView = DayCapacityBody
export type CapacityBadges = Record<string, CapacityBadge>

/** What a switch names: the day, a period by its key, or a slot by its time. */
export type StopChoice = { scope: 'day' } | { scope: 'period'; periodLabel: string } | { scope: 'slot'; time: string }

export interface PendingNote {
  /** The period key it is about. */
  key: string
  count: number
}

const BASE = '/api/dashboard/bookings'

export function stopTargetOf(date: string, choice: StopChoice): StopTarget {
  return {
    date, scope: choice.scope,
    periodLabel: choice.scope === 'period' ? choice.periodLabel : null,
    time: choice.scope === 'slot' ? choice.time : null,
  }
}

/** A period key or HH:MM as a test-id part: "18:00-21:30" → "1800-2130", spaces → "-". */
export const capacityTestKey = (key: string) => key.replace(/:/g, '').replace(/\s+/g, '-')

/** HH:MM in Hong Kong ("Stopped by Amy · 14:02"). */
export function hkClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

const flip = <T extends { stopped: boolean }>(item: T, stopped: boolean): T => ({ ...item, stopped, ...(stopped ? {} : { stoppedBy: null, stoppedAt: null }) })

/** The day with exactly `target` stopped or resumed (the switch's optimistic state). */
export function withStop(day: CapacityDayView, target: StopTarget, stopped: boolean): CapacityDayView {
  if (target.scope === 'day') return flip(day, stopped)
  const periods = day.periods.map((p) => {
    if (target.scope === 'period') return p.key === target.periodLabel ? flip(p, stopped) : p
    return { ...p, slots: p.slots.map((s) => (s.time === target.time ? flip(s, stopped) : s)) }
  })
  return { ...day, periods }
}

/** Pending requests on `date` inside the period's range (the "N requests still need a reply" note). */
export function pendingInPeriod(bookings: readonly BookingItem[], date: string, period: Pick<CapacityPeriod, 'first' | 'last'>): number {
  return bookings.filter((b) => b.bookingDate === date && b.status === 'pending' && period.first <= b.bookingTime && b.bookingTime <= period.last).length
}

function stopBody(target: StopTarget): Record<string, string> {
  const body: Record<string, string> = { date: target.date, scope: target.scope }
  if (target.periodLabel !== null) body.periodLabel = target.periodLabel
  if (target.time !== null) body.time = target.time
  return body
}

/** POST (stop) or DELETE (resume); true when the server took it. */
export async function sendStop(target: StopTarget, stopped: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/stops`, {
      method: stopped ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stopBody(target)),
    })
    return res.ok
  } catch {
    return false
  }
}

export interface StopSinks {
  apply(day: CapacityDayView): void
  setError(error: boolean): void
  reload(): void
}

/** Flip at once; on failure put the day back as it was and show the error; on success reload. */
export async function runStopToggle(
  sinks: StopSinks,
  input: { day: CapacityDayView; target: StopTarget; stopped: boolean; send: typeof sendStop }
): Promise<boolean> {
  sinks.apply(withStop(input.day, input.target, input.stopped))
  const ok = await input.send(input.target, input.stopped)
  if (!ok) sinks.apply(input.day)
  sinks.setError(!ok)
  if (ok) sinks.reload()
  return ok
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

/** The day panel's block for `date` (null while loading, when it could not load, or with no date). */
function useCapacityDay(date: string | null, version: number) {
  const [loaded, setLoaded] = useState<CapacityDayView | null>(null)
  useEffect(() => {
    if (!date) return
    let active = true
    void getJson<CapacityDayView>(`${BASE}/capacity?date=${date}`).then((body) => {
      if (active) setLoaded(body)
    })
    return () => {
      active = false
    }
  }, [date, version])
  return { day: date && loaded?.date === date ? loaded : null, setDay: setLoaded }
}

/** Month badges for the grid's range (null range = none, e.g. the phone week strip). */
function useCapacityBadges(range: { from: string; to: string } | null, version: number) {
  const [badges, setBadges] = useState<CapacityBadges>({})
  const from = range?.from
  const to = range?.to
  useEffect(() => {
    if (!from || !to) return
    let active = true
    void getJson<{ days: CapacityBadges }>(`${BASE}/capacity?from=${from}&to=${to}`).then((body) => {
      if (active && body) setBadges(body.days)
    })
    return () => {
      active = false
    }
  }, [from, to, version])
  return badges
}

/** `date` null = no day block (the Table view); `range` null = no month badges (phone, Table). */
export function useBookingCapacity(date: string | null, range: { from: string; to: string } | null) {
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const { day, setDay } = useCapacityDay(date, version)
  const badges = useCapacityBadges(range, version)
  // The error and the note belong to the day they were made on; another day starts clean.
  const [errorOn, setErrorOn] = useState<string | null>(null)
  const [note, setNote] = useState<(PendingNote & { date: string }) | null>(null)

  async function toggle(choice: StopChoice, stopped: boolean, pending = 0) {
    if (!day || !date) return
    setNote(null)
    const setError = (error: boolean) => setErrorOn(error ? date : null)
    const ok = await runStopToggle({ apply: setDay, setError, reload }, { day, target: stopTargetOf(date, choice), stopped, send: sendStop })
    if (ok && stopped && choice.scope === 'period' && pending > 0) setNote({ date, key: choice.periodLabel, count: pending })
  }

  return { day, badges, error: errorOn === date, note: note?.date === date ? note : null, toggle, reload }
}
