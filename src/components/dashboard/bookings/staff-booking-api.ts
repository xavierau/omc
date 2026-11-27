/**
 * BOOK-013: the browser side of the staff booking APIs, and how each answer
 * maps to what the page shows (spec UI Feedback States). Pure mappers, so
 * the outcomes are testable without a browser.
 */
import type { BookingItem } from '@/hooks/use-bookings'
import type { BookingDepositView } from '@/domain/entities/booking-request'
import type { BrokenRule } from '@/domain/services/staff-booking-rules'

const BASE = '/api/dashboard/bookings'

export interface StaffBookingForm {
  phone: string
  name: string
  partySize: number
  date: string
  time: string
  notes: string
  notify: boolean
  /** BOOK-014 W4 (spec AC-11): "Require deposit", on by default; sent only when the rule applies. */
  requireDeposit: boolean
}

export type StaffMessage = 'delivered' | 'not_delivered' | 'throttled' | 'none'

export type StaffSaveOutcome =
  | { kind: 'saved'; booking: BookingItem; message: StaffMessage; paymentUrl?: string }
  /** BOOK-014 W4 (R54): the provider failed; nothing was saved. */
  | { kind: 'payment_unavailable' }
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'rules'; rules: BrokenRule[] }
  | { kind: 'stale' }
  | { kind: 'open_change' }
  | { kind: 'booking_off' }
  | { kind: 'not_found' }
  | { kind: 'error' }

export function staffSaveOutcome(status: number, body: unknown): StaffSaveOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as {
    booking?: BookingItem
    message?: StaffMessage
    error?: string
    fields?: Record<string, string>
    rules?: BrokenRule[]
    paymentUrl?: unknown
  }
  if ((status === 200 || status === 201) && b.booking) {
    const paymentUrl = typeof b.paymentUrl === 'string' && /^https?:\/\//.test(b.paymentUrl) ? b.paymentUrl : undefined
    return { kind: 'saved', booking: b.booking, message: b.message ?? 'none', ...(paymentUrl ? { paymentUrl } : {}) }
  }
  if (status === 503 && b.error === 'payment_unavailable') return { kind: 'payment_unavailable' }
  if (status === 400) return { kind: 'invalid', fields: b.fields ?? {} }
  if (status === 404) return { kind: 'not_found' }
  if (status === 409 && b.error === 'rules' && Array.isArray(b.rules)) return { kind: 'rules', rules: b.rules }
  if (status === 409 && b.error === 'open_change') return { kind: 'open_change' }
  if (status === 409 && b.error === 'booking_off') return { kind: 'booking_off' }
  if (status === 409) return { kind: 'stale' }
  return { kind: 'error' }
}

async function call(url: string, method: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function save(url: string, method: string, body: unknown): Promise<StaffSaveOutcome> {
  try {
    const { status, json } = await call(url, method, body)
    return staffSaveOutcome(status, json)
  } catch {
    return { kind: 'error' }
  }
}

/** The request body: only the allow-listed fields (R4); notes empty = none; no phone = Notify off (decision 9, AC-26). */
export function formBody(form: StaffBookingForm, extra: { override?: boolean; expectedVersion?: number } = {}) {
  const phone = form.phone.trim()
  return {
    phone, name: form.name, partySize: form.partySize, date: form.date, time: form.time,
    notes: form.notes.trim() === '' ? null : form.notes, notify: form.notify && phone !== '', ...extra,
  }
}

/** BOOK-014 W4: a new booking also says whether staff kept the deposit on (the server applies its own rule, R53). */
export const createStaffBooking = (form: StaffBookingForm, override = false) =>
  save(BASE, 'POST', { ...formBody(form, override ? { override: true } : {}), requireDeposit: form.requireDeposit })

/** R3 (review R1): `expectedVersion` is the booking's `editVersion` as the form loaded it. */
export const editStaffBooking = (id: string, form: StaffBookingForm, expectedVersion: number, override = false) =>
  save(`${BASE}/${encodeURIComponent(id)}`, 'PATCH', formBody(form, { expectedVersion, ...(override ? { override: true } : {}) }))

export const cancelStaffBooking = (id: string, expectedVersion: number, notify: boolean) =>
  save(`${BASE}/${encodeURIComponent(id)}/cancel`, 'POST', { expectedVersion, notify })

export type CheckInOutcome = { kind: 'done'; booking: BookingItem } | { kind: 'refused'; reason: string } | { kind: 'error' }

export function checkInOutcome(status: number, body: unknown): CheckInOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { booking?: BookingItem; error?: string }
  if (status === 200 && b.booking) return { kind: 'done', booking: b.booking }
  if (status === 409 || status === 404) return { kind: 'refused', reason: b.error ?? 'not_found' }
  return { kind: 'error' }
}

export async function requestCheckIn(id: string, move: 'arrive' | 'undo'): Promise<CheckInOutcome> {
  try {
    const { status, json } = await call(`${BASE}/${encodeURIComponent(id)}/check-in`, move === 'arrive' ? 'POST' : 'DELETE')
    return checkInOutcome(status, json)
  } catch {
    return { kind: 'error' }
  }
}

export interface TodayPayload {
  date: string
  bookings: BookingItem[]
  truncated: boolean
}

export async function fetchToday(): Promise<TodayPayload | null> {
  try {
    const { status, json } = await call(`${BASE}/today`, 'GET')
    return status === 200 && json && typeof json === 'object' ? (json as TodayPayload) : null
  } catch {
    return null
  }
}

/**
 * The form for a new booking on `date` (the day panel's Add), or for editing
 * `booking`. A booking without a phone starts with Notify ticked, so adding a
 * phone offers it checked (AC-28); with the phone empty it is shown off.
 */
export function initialForm(date: string, booking?: BookingItem | null): StaffBookingForm {
  if (!booking) return { phone: '', name: '', partySize: 2, date, time: '', notes: '', notify: true, requireDeposit: true }
  return {
    phone: booking.phone ?? '', name: booking.name ?? '', partySize: booking.partySize, date: booking.bookingDate,
    time: booking.bookingTime, notes: booking.notes ?? '', notify: booking.phone ? (booking.notifyDiner ?? true) : true, requireDeposit: false,
  }
}

/** Spec S2 (frame 4): the fields an edit changed, marked "changed" in the form. */
export function changedFormFields(booking: BookingItem, form: StaffBookingForm): Set<keyof StaffBookingForm> {
  const before = initialForm(booking.bookingDate, booking)
  const keys: Array<keyof StaffBookingForm> = ['phone', 'name', 'partySize', 'date', 'time', 'notes']
  return new Set(keys.filter((k) => before[k] !== form[k]))
}

/** Edit and Cancel are offered on pending/confirmed rows without an open change request (AC-10); cancel on confirmed only. */
const hasVersion = (b: BookingItem) => typeof b.editVersion === 'number'
export const canEditBooking = (b: BookingItem) => (b.status === 'pending' || b.status === 'confirmed') && !b.openChange && hasVersion(b)
export const canCancelBooking = (b: BookingItem) => b.status === 'confirmed' && !b.openChange && hasVersion(b)

/** BOOK-014 W4 (spec AC-12, AC-13): Refund (or Retry) / Keep a deposit. */
export type DepositMove = 'refund' | 'keep'
export type DepositMoveOutcome =
  | { kind: 'done'; deposit: BookingDepositView }
  | { kind: 'conflict' }
  | { kind: 'not_found' }
  | { kind: 'error' }

export function depositMoveOutcome(status: number, body: unknown): DepositMoveOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { deposit?: BookingDepositView }
  if (status === 200 && b.deposit) return { kind: 'done', deposit: b.deposit }
  if (status === 409) return { kind: 'conflict' }
  if (status === 404) return { kind: 'not_found' }
  return { kind: 'error' }
}

export async function requestDepositMove(id: string, move: DepositMove): Promise<DepositMoveOutcome> {
  try {
    const { status, json } = await call(`${BASE}/${encodeURIComponent(id)}/deposit/${move}`, 'POST')
    return depositMoveOutcome(status, json)
  } catch {
    return { kind: 'error' }
  }
}

/** BOOK-014 W4: the payment link of a staff booking awaiting its deposit, or null. */
export async function fetchDepositLink(id: string): Promise<string | null> {
  try {
    const { status, json } = await call(`${BASE}/${encodeURIComponent(id)}/deposit/link`, 'GET')
    const url = status === 200 && json && typeof json === 'object' ? (json as { url?: unknown }).url : null
    return typeof url === 'string' && url.startsWith('https://') ? url : null
  } catch {
    return null
  }
}

/** BOOK-014 W4: the restaurant's deposit rule as the form shows it (display only; the server decides, R53). */
export interface StaffDepositRule {
  mode: 'per_guest' | 'per_booking'
  amount: number
  fromPartySize: number
  currency: string
}

export async function fetchStaffDepositRule(): Promise<StaffDepositRule | null> {
  try {
    const { status, json } = await call(`${BASE}/deposit-rule`, 'GET')
    const d = status === 200 && json && typeof json === 'object' ? (json as { deposit?: StaffDepositRule | null }).deposit : null
    return d && typeof d.amount === 'number' && typeof d.fromPartySize === 'number' && typeof d.currency === 'string' ? d : null
  } catch {
    return null
  }
}
