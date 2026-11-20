'use client'

/**
 * BOOK-007: the dashboard's mark / undo no-show calls (POST / DELETE
 * /api/dashboard/bookings/[id]/no-show) and the notice when the booking had
 * already moved on, was not past yet, had an open change request (r1 F3) or
 * the call failed. A done move shows no notice: the row's badge and action
 * change. The busy rows live in useBookingRowActions (r1 F4).
 */
import { useState } from 'react'
import type { BookingItem } from '@/hooks/use-bookings'

export type NoShowMove = 'mark' | 'undo'
export type NoShowFn = (id: string, move: NoShowMove) => void

export type NoShowOutcome =
  | { kind: 'done' }
  | { kind: 'already_handled'; status: BookingItem['status'] }
  | { kind: 'not_past' }
  | { kind: 'change_pending' }
  | { kind: 'not_found' }
  | { kind: 'error' }

const REFUSALS = new Set(['not_past', 'change_pending'])

export function noShowOutcome(status: number, body: unknown): NoShowOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { booking?: unknown; error?: string; status?: BookingItem['status'] }
  if (status === 200 && b.booking) return { kind: 'done' }
  if (status === 409 && b.error && REFUSALS.has(b.error)) return { kind: b.error as 'not_past' | 'change_pending' }
  if (status === 409 && b.status) return { kind: 'already_handled', status: b.status }
  if (status === 404) return { kind: 'not_found' }
  return { kind: 'error' }
}

export async function requestNoShow(id: string, move: NoShowMove): Promise<NoShowOutcome> {
  try {
    const res = await fetch(`/api/dashboard/bookings/${encodeURIComponent(id)}/no-show`, { method: move === 'mark' ? 'POST' : 'DELETE' })
    return noShowOutcome(res.status, await res.json().catch(() => null))
  } catch {
    return { kind: 'error' }
  }
}

export type NoShowNotice =
  | { kind: 'already_handled'; status: BookingItem['status'] }
  | { kind: 'not_past' }
  | { kind: 'change_pending' }
  | { kind: 'error' }
  | null

const noticeFor = (outcome: NoShowOutcome): NoShowNotice =>
  outcome.kind === 'done' ? null : outcome.kind === 'not_found' ? { kind: 'error' } : outcome

/** The move resolves only after the list has reloaded, so its row stays busy until then (as runDecision, review F4). */
export function useBookingNoShow(refetch: () => Promise<void>) {
  const [notice, setNotice] = useState<NoShowNotice>(null)

  async function act(id: string, move: NoShowMove) {
    setNotice(noticeFor(await requestNoShow(id, move)))
    await refetch()
  }

  return { notice, act, clearNotice: () => setNotice(null) }
}
