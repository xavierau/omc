'use client'

/**
 * BOOK-008: the Bookings page's member calls. `searchMembers` reads the
 * members list search (GET /api/dashboard/members?search=, tenant-scoped,
 * name or phone); `requestMemberLink` is PATCH /api/dashboard/bookings/[id]/member
 * (link, relink, unlink). Every outcome reloads the list, so a refused or
 * stale link shows what the booking really holds now.
 */
import { createContext, useEffect, useState } from 'react'

export interface MemberOption {
  id: string
  name: string | null
  phone: string
}

/** Results one search shows: enough to pick from, small enough for a phone screen. */
export const MEMBER_SEARCH_LIMIT = 8
const SEARCH_DEBOUNCE_MS = 250

export function memberSearchUrl(query: string): string {
  const params = new URLSearchParams({ search: query.trim(), pageSize: String(MEMBER_SEARCH_LIMIT), sortBy: 'name', sortOrder: 'asc' })
  return `/api/dashboard/members?${params}`
}

/** Null when the search failed (the picker says so); an empty array when nothing matched. */
export async function searchMembers(query: string): Promise<MemberOption[] | null> {
  try {
    const res = await fetch(memberSearchUrl(query))
    if (!res.ok) return null
    const body = (await res.json()) as { members?: Array<{ id: string; name: string | null; phone: string }> }
    return (body.members ?? []).map((m) => ({ id: m.id, name: m.name, phone: m.phone }))
  } catch {
    return null
  }
}

export type MemberLinkOutcome = { kind: 'done' } | { kind: 'not_found' } | { kind: 'changed' } | { kind: 'error' }

export function memberLinkOutcome(status: number, body: unknown): MemberLinkOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { booking?: unknown }
  if (status === 200 && b.booking) return { kind: 'done' }
  if (status === 404) return { kind: 'not_found' }
  if (status === 409) return { kind: 'changed' }
  return { kind: 'error' }
}

export async function requestMemberLink(bookingId: string, memberId: string | null): Promise<MemberLinkOutcome> {
  try {
    const res = await fetch(`/api/dashboard/bookings/${encodeURIComponent(bookingId)}/member`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    return memberLinkOutcome(res.status, await res.json().catch(() => null))
  } catch {
    return { kind: 'error' }
  }
}

export type LinkMemberFn = (bookingId: string, memberId: string | null) => Promise<void>

export interface BookingMemberActions {
  /** Opens the member panel for this member. */
  openMember(memberId: string): void
  link: LinkMemberFn
  busyIds: ReadonlySet<string>
}

/** Provided by the Bookings screen; without it a booking's name is plain text and offers no link control. */
export const BookingMemberContext = createContext<BookingMemberActions | null>(null)

export interface MemberLinkSinks {
  setBusy(update: (prev: ReadonlySet<string>) => ReadonlySet<string>): void
  setFailed(failed: boolean): void
  refetch(): Promise<void>
}

/** One link call: the row is busy until the list has reloaded; any outcome but done shows the failure line. */
export function memberLinkAction(sinks: MemberLinkSinks, request = requestMemberLink): LinkMemberFn {
  return async (bookingId, memberId) => {
    sinks.setFailed(false)
    sinks.setBusy((prev) => new Set(prev).add(bookingId))
    try {
      const outcome = await request(bookingId, memberId)
      sinks.setFailed(outcome.kind !== 'done')
      await sinks.refetch()
    } finally {
      sinks.setBusy((prev) => new Set([...prev].filter((id) => id !== bookingId)))
    }
  }
}

export function useBookingMemberLink(refetch: () => Promise<void>) {
  const [busyIds, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState(false)
  const [openMemberId, setOpenMemberId] = useState<string | null>(null)
  const link = memberLinkAction({ setBusy, setFailed, refetch })
  return { busyIds, failed, link, openMemberId, openMember: setOpenMemberId, closeMember: () => setOpenMemberId(null) }
}

export type MemberSearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; members: MemberOption[] }
  | { kind: 'failed' }

/**
 * One debounced search: an empty query is idle at once; otherwise loading,
 * then results or failed. The returned function cancels it, so a newer
 * query's answer is never overwritten by an older one.
 */
export function startMemberSearch(
  query: string,
  onState: (state: MemberSearchState) => void,
  search: (q: string) => Promise<MemberOption[] | null> = searchMembers
): () => void {
  const q = query.trim()
  if (!q) {
    onState({ kind: 'idle' })
    return () => {}
  }
  let live = true
  onState({ kind: 'loading' })
  const timer = setTimeout(async () => {
    const members = await search(q)
    if (live) onState(members ? { kind: 'results', members } : { kind: 'failed' })
  }, SEARCH_DEBOUNCE_MS)
  return () => {
    live = false
    clearTimeout(timer)
  }
}

/** Debounced search while the picker is open; an empty query shows nothing. */
export function useMemberSearch(query: string): MemberSearchState {
  const [state, setState] = useState<MemberSearchState>({ kind: 'idle' })
  useEffect(() => startMemberSearch(query, setState), [query])
  return state
}
