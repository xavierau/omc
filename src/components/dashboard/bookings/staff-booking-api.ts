/**
 * BOOK-013: the browser side of the staff booking APIs, and how each answer
 * maps to what the page shows (spec UI Feedback States). Pure mappers, so
 * the outcomes are testable without a browser.
 */
import type { BookingItem } from '@/hooks/use-bookings'
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
}

export type StaffMessage = 'delivered' | 'not_delivered' | 'throttled' | 'none'

export type StaffSaveOutcome =
  | { kind: 'saved'; booking: BookingItem; message: StaffMessage }
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
  }
  if ((status === 200 || status === 201) && b.booking) return { kind: 'saved', booking: b.booking, message: b.message ?? 'none' }
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

/** The request body: only the allow-listed fields (R4); notes empty = none. */
export function formBody(form: StaffBookingForm, extra: { override?: boolean; expectedUpdatedAt?: string } = {}) {
  return {
    phone: form.phone.trim(), name: form.name, partySize: form.partySize, date: form.date, time: form.time,
    notes: form.notes.trim() === '' ? null : form.notes, notify: form.notify, ...extra,
  }
}

export const createStaffBooking = (form: StaffBookingForm, override = false) =>
  save(BASE, 'POST', formBody(form, override ? { override: true } : {}))

export const editStaffBooking = (id: string, form: StaffBookingForm, expectedUpdatedAt: string, override = false) =>
  save(`${BASE}/${encodeURIComponent(id)}`, 'PATCH', formBody(form, { expectedUpdatedAt, ...(override ? { override: true } : {}) }))

export const cancelStaffBooking = (id: string, expectedUpdatedAt: string, notify: boolean) =>
  save(`${BASE}/${encodeURIComponent(id)}/cancel`, 'POST', { expectedUpdatedAt, notify })

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

export type CodeLookup = { kind: 'found'; booking: BookingItem; today: boolean } | { kind: 'not_found' } | { kind: 'error' }

export async function lookupCode(code: string): Promise<CodeLookup> {
  try {
    const { status, json } = await call(`${BASE}/by-code/${encodeURIComponent(code)}`, 'GET')
    const b = (json ?? {}) as { booking?: BookingItem; today?: boolean }
    if (status === 200 && b.booking) return { kind: 'found', booking: b.booking, today: b.today === true }
    return status === 404 ? { kind: 'not_found' } : { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

/** The form for a new booking on `date` (the day panel's Add), or for editing `booking`. */
export function initialForm(date: string, booking?: BookingItem | null): StaffBookingForm {
  if (!booking) return { phone: '', name: '', partySize: 2, date, time: '', notes: '', notify: true }
  return {
    phone: booking.phone, name: booking.name ?? '', partySize: booking.partySize, date: booking.bookingDate,
    time: booking.bookingTime, notes: booking.notes ?? '', notify: booking.notifyDiner ?? true,
  }
}

/** Spec S2 (frame 4): the fields an edit changed, marked "changed" in the form. */
export function changedFormFields(booking: BookingItem, form: StaffBookingForm): Set<keyof StaffBookingForm> {
  const before = initialForm(booking.bookingDate, booking)
  const keys: Array<keyof StaffBookingForm> = ['phone', 'name', 'partySize', 'date', 'time', 'notes']
  return new Set(keys.filter((k) => before[k] !== form[k]))
}

/** Edit and Cancel are offered on pending/confirmed rows without an open change request (AC-10); cancel on confirmed only. */
export const canEditBooking = (b: BookingItem) => (b.status === 'pending' || b.status === 'confirmed') && !b.openChange && !!b.updatedAt
export const canCancelBooking = (b: BookingItem) => b.status === 'confirmed' && !b.openChange && !!b.updatedAt
