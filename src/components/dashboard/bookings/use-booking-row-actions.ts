'use client'

/**
 * BOOK-007 r1 F4: the Bookings page's row actions (confirm / decline and mark
 * / undo no-show) share one busy set, so every row with a call in flight stays
 * disabled until its list reload is done, and starting any action clears the
 * notice the other kind left behind.
 */
import { useState } from 'react'
import { useBookingActions, type BookingNotice } from '@/hooks/use-bookings'
import { useBookingNoShow, type NoShowMove } from './use-booking-no-show'

type Decision = 'confirm' | 'decline'

export interface RowActionSinks {
  setBusy(update: (prev: ReadonlySet<string>) => ReadonlySet<string>): void
  clearNotices(): void
}

export interface RowActionRuns {
  decide(id: string, decision: Decision, reason?: string): Promise<void>
  noShow(id: string, move: NoShowMove): Promise<void>
}

const without = (prev: ReadonlySet<string>, id: string) => new Set([...prev].filter((x) => x !== id))

/** Each action: clear both notices, mark its row busy, run it, release the row (also when it throws). */
export function rowActions(sinks: RowActionSinks, runs: RowActionRuns) {
  async function track(id: string, work: () => Promise<void>) {
    sinks.clearNotices()
    sinks.setBusy((prev) => new Set(prev).add(id))
    try {
      await work()
    } finally {
      sinks.setBusy((prev) => without(prev, id))
    }
  }
  return {
    onDecide: (id: string, decision: Decision, reason?: string) => track(id, () => runs.decide(id, decision, reason)),
    onNoShow: (id: string, move: NoShowMove) => track(id, () => runs.noShow(id, move)),
  }
}

/** The decide hook keeps its last notice; once an action starts, that one is stale and stays hidden. */
export function visibleNotice(notice: BookingNotice | null, hidden: BookingNotice | null): BookingNotice | null {
  return notice === hidden ? null : notice
}

export function useBookingRowActions(refetch: () => Promise<void>) {
  const decide = useBookingActions(refetch)
  const noShow = useBookingNoShow(refetch)
  const [busyIds, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [hidden, setHidden] = useState<BookingNotice | null>(null)
  const clearNotices = () => {
    setHidden(decide.notice)
    noShow.clearNotice()
  }
  const { onDecide, onNoShow } = rowActions({ setBusy, clearNotices }, { decide: decide.act, noShow: noShow.act })
  return {
    busyIds,
    undelivered: decide.undelivered,
    decideNotice: visibleNotice(decide.notice, hidden),
    noShowNotice: noShow.notice,
    onDecide,
    onNoShow,
  }
}
