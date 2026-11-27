'use client'

/**
 * BOOK-013 S1–S3, S7: the Bookings page's staff actions. One form (new or
 * edit) with the rules prompt and the stale banner, one cancel dialog, the
 * Arrived / Undo moves, and the toast. Rows reach them through
 * StaffBookingContext (as BOOK-008's member actions), so every view (day
 * panel, table, cards, Today) offers the same menu without prop threading.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { BookingItem } from '@/hooks/use-bookings'
import type { BrokenRule } from '@/domain/services/staff-booking-rules'
import {
  cancelStaffBooking,
  createStaffBooking,
  editStaffBooking,
  fetchDepositLink,
  initialForm,
  requestCheckIn,
  requestDepositMove,
  type DepositMove,
  type StaffBookingForm,
  type StaffMessage,
  type StaffSaveOutcome,
} from './staff-booking-api'

export interface FormState {
  mode: 'new' | 'edit'
  booking: BookingItem | null
  values: StaffBookingForm
  errors: Record<string, string>
  rules: BrokenRule[] | null
  /** AC-11 / AC-13: changed by someone else; nothing was saved. */
  stale: 'changed' | 'open_change' | null
  saving: boolean
}

/** BOOK-014 W4 (spec AC-13): what happens to a paid deposit when staff cancel. */
export type CancelDepositChoice = 'later' | 'refund' | 'keep'

export interface CancelState {
  booking: BookingItem
  notify: boolean
  saving: boolean
  stale: boolean
  deposit: CancelDepositChoice
}

export type ToastKind =
  | 'added' | 'updated' | 'cancelled' | 'throttled' | 'not_delivered' | 'failed' | 'off'
  // BOOK-014 W4: the deposit link after create, the deposit moves and Copy link.
  | 'deposit_sent' | 'deposit_not_sent' | 'payment_unavailable' | 'link_copied' | 'link_copy_failed'
  | 'refunded' | 'refund_started' | 'refund_failed' | 'kept' | 'deposit_conflict' | 'deposit_failed'
export interface Toast {
  kind: ToastKind
  /** For "Booking added · Sat 21 Nov, 19:00, 6 pax". */
  booking?: BookingItem
  /** BOOK-014 W4: Copy link on the toast (the link was not delivered). */
  paymentUrl?: string
}

export interface StaffBookingActions {
  openNew(date: string): void
  openEdit(booking: BookingItem): void
  openCancel(booking: BookingItem): void
  checkIn(id: string, move: 'arrive' | 'undo'): Promise<void>
  checkInBusy: ReadonlySet<string>
  /** The id whose Arrived was refused last ("This booking changed"). */
  checkInRefused: string | null
  /** BOOK-014 W4 (spec AC-12, AC-13): Refund (or Retry) / Keep, and Copy link. */
  depositMove(id: string, move: DepositMove): Promise<void>
  copyDepositLink(id: string): Promise<void>
  depositBusy: ReadonlySet<string>
}

const NOOP: StaffBookingActions = {
  openNew: () => {}, openEdit: () => {}, openCancel: () => {}, checkIn: async () => {}, checkInBusy: new Set(), checkInRefused: null,
  depositMove: async () => {}, copyDepositLink: async () => {}, depositBusy: new Set(),
}

export const StaffBookingContext = createContext<StaffBookingActions>(NOOP)
export const useStaffBookingActions = () => useContext(StaffBookingContext)

const TOAST_MS = 6000

/** The toast after a save: the message outcome wins over the plain success line (spec UI states). */
export function toastFor(saved: 'added' | 'updated' | 'cancelled', message: StaffMessage): ToastKind {
  if (message === 'not_delivered') return 'not_delivered'
  if (message === 'throttled') return 'throttled'
  return saved
}

/** What a save answer does to the open form; null = the form closes (saved). */
export function formAfter(form: FormState, outcome: StaffSaveOutcome): FormState | null {
  const done = { ...form, saving: false }
  switch (outcome.kind) {
    case 'saved':
      return null
    case 'invalid':
      return { ...done, errors: outcome.fields, rules: null }
    case 'rules':
      return { ...done, rules: outcome.rules }
    case 'stale':
    case 'not_found':
      return { ...done, stale: 'changed', rules: null }
    case 'open_change':
      return { ...done, stale: 'open_change', rules: null }
    default:
      return { ...done, rules: null }
  }
}

function useToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((next: Toast) => {
    if (timer.current) clearTimeout(timer.current)
    setToast(next)
    timer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  return { toast, show, dismiss: () => setToast(null) }
}

function useCheckIn(refetch: () => Promise<void>) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [refused, setRefused] = useState<string | null>(null)
  const checkIn = useCallback(async (id: string, move: 'arrive' | 'undo') => {
    setRefused(null)
    setBusy((prev) => new Set(prev).add(id))
    try {
      const outcome = await requestCheckIn(id, move)
      if (outcome.kind !== 'done') setRefused(id)
      await refetch()
    } finally {
      setBusy((prev) => new Set([...prev].filter((x) => x !== id)))
    }
  }, [refetch])
  return { checkIn, busy, refused }
}

/** BOOK-014 W4: the toast after a staff create that asked for a deposit (spec UI states). */
export function depositToastFor(message: StaffMessage): ToastKind {
  return message === 'delivered' ? 'deposit_sent' : 'deposit_not_sent'
}

const MOVE_TOAST = { refunded: 'refunded', refund_pending: 'refund_started', refund_failed: 'refund_failed', kept: 'kept' } as const

/** BOOK-014 W4: the toast a deposit move answers with. */
export function depositMoveToast(outcome: Awaited<ReturnType<typeof requestDepositMove>>): ToastKind {
  if (outcome.kind === 'done') return MOVE_TOAST[outcome.deposit.status as keyof typeof MOVE_TOAST] ?? 'refund_started'
  if (outcome.kind === 'conflict' || outcome.kind === 'not_found') return 'deposit_conflict'
  return 'deposit_failed'
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function useDepositActions(refetch: () => Promise<void>, show: (t: Toast) => void) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const track = useCallback(async (id: string, work: () => Promise<void>) => {
    setBusy((prev) => new Set(prev).add(id))
    try {
      await work()
    } finally {
      setBusy((prev) => new Set([...prev].filter((x) => x !== id)))
    }
  }, [])
  const move = useCallback(
    (id: string, m: DepositMove) =>
      track(id, async () => {
        show({ kind: depositMoveToast(await requestDepositMove(id, m)) })
        await refetch()
      }),
    [track, show, refetch]
  )
  const copyLink = useCallback(
    (id: string) =>
      track(id, async () => {
        const url = await fetchDepositLink(id)
        show({ kind: url && (await copyText(url)) ? 'link_copied' : 'link_copy_failed' })
      }),
    [track, show]
  )
  return { move, copyLink, busy }
}

export function useStaffBooking(refetch: () => Promise<void>) {
  const [form, setForm] = useState<FormState | null>(null)
  const [cancel, setCancel] = useState<CancelState | null>(null)
  const { toast, show, dismiss } = useToast()
  const checkIn = useCheckIn(refetch)
  const deposit = useDepositActions(refetch, show)

  const open = (mode: FormState['mode'], booking: BookingItem | null, date: string) =>
    setForm({ mode, booking, values: initialForm(date, booking), errors: {}, rules: null, stale: null, saving: false })

  async function submit(override = false) {
    if (!form || form.saving) return
    setForm({ ...form, saving: true, errors: {} })
    const outcome =
      form.mode === 'new' || !form.booking
        ? await createStaffBooking(form.values, override)
        : await editStaffBooking(form.booking.id, form.values, form.booking.editVersion as number, override)
    setForm(formAfter(form, outcome))
    if (outcome.kind === 'saved' && outcome.paymentUrl) {
      // BOOK-014 W4 (spec AC-11): awaiting deposit; Copy link stays on the toast when the link did not go out.
      const kind = depositToastFor(outcome.message)
      show({ kind, booking: outcome.booking, ...(kind === 'deposit_not_sent' ? { paymentUrl: outcome.paymentUrl } : {}) })
      await refetch()
    } else if (outcome.kind === 'saved') {
      show({ kind: toastFor(form.mode === 'new' ? 'added' : 'updated', outcome.message), booking: outcome.booking })
      await refetch()
    } else if (outcome.kind === 'booking_off') show({ kind: 'off' })
    else if (outcome.kind === 'payment_unavailable') show({ kind: 'payment_unavailable' })
    else if (outcome.kind === 'error') show({ kind: 'failed' })
  }

  async function confirmCancel() {
    if (!cancel || cancel.saving) return
    setCancel({ ...cancel, saving: true })
    const outcome = await cancelStaffBooking(cancel.booking.id, cancel.booking.editVersion as number, cancel.notify && !!cancel.booking.phone)
    if (outcome.kind === 'saved') {
      setCancel(null)
      show({ kind: toastFor('cancelled', outcome.message), booking: outcome.booking })
      // BOOK-014 W4 (spec AC-13): the deposit decision staff picked, once the cancel is saved.
      if (cancel.deposit !== 'later') {
        const moved = await requestDepositMove(cancel.booking.id, cancel.deposit)
        show({ kind: depositMoveToast(moved) })
      }
    } else if (outcome.kind === 'error') {
      setCancel({ ...cancel, saving: false })
      show({ kind: 'failed' })
      return
    } else {
      setCancel({ ...cancel, saving: false, stale: true })
    }
    await refetch()
  }

  const actions: StaffBookingActions = {
    openNew: (date) => open('new', null, date),
    openEdit: (booking) => open('edit', booking, booking.bookingDate),
    openCancel: (booking) => setCancel({ booking, notify: true, saving: false, stale: false, deposit: 'later' }),
    checkIn: checkIn.checkIn,
    checkInBusy: checkIn.busy,
    checkInRefused: checkIn.refused,
    depositMove: deposit.move,
    copyDepositLink: deposit.copyLink,
    depositBusy: deposit.busy,
  }

  return {
    actions,
    form,
    setValues: (values: StaffBookingForm) => form && setForm({ ...form, values }),
    closeForm: () => setForm(null),
    submit,
    backFromRules: () => form && setForm({ ...form, rules: null }),
    reloadStale: async () => {
      setForm(null)
      await refetch()
    },
    cancel,
    setCancelNotify: (notify: boolean) => cancel && setCancel({ ...cancel, notify }),
    setCancelDeposit: (choice: CancelDepositChoice) => cancel && setCancel({ ...cancel, deposit: choice }),
    /** BOOK-014 W4: Copy link on the toast after create. */
    copyToastLink: async (url: string) => show({ kind: (await copyText(url)) ? 'link_copied' : 'link_copy_failed' }),
    closeCancel: () => setCancel(null),
    confirmCancel,
    toast,
    dismissToast: dismiss,
  }
}

export type StaffBookingController = ReturnType<typeof useStaffBooking>
