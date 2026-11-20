'use client'

/**
 * BOOK-009 S2: the slot booking form's state and submit (spec AC-6, AC-7,
 * AC-9). A refusal with a time/date code means the page's times are out of
 * date: the chosen time is cleared, the page's server data is refreshed (the
 * view model recomputes the slots with the current hours and clock), and
 * party size, name and notes stay as typed.
 */
import { useState } from 'react'
import { postBooking, type BookingSubmitOutcome } from '@/components/booking/booking-form-client'
import { missingStep, timesChanged } from '@/components/booking/slot-picker-model'

export interface SlotFormValues {
  partySize: number | null
  date: string
  time: string
  name: string
  notes: string
  accepted: boolean
}

export const EMPTY_SLOT_FORM: SlotFormValues = { partySize: null, date: '', time: '', name: '', notes: '', accepted: false }

export interface SlotFormOptions {
  token: string
  termsRequired: boolean
  /** Admin Preview: nothing is sent. */
  preview: boolean
  /** Re-reads the page's server data (router.refresh on the booking page). */
  refresh: () => void
}

export interface SubmitStep {
  outcome: BookingSubmitOutcome
  values: SlotFormValues
  /** The time the diner had picked when the times changed, else null. */
  changedTime: string | null
}

/** What a submit answer does to the form (pure; AC-9 keeps party, day, name and notes). */
export function applySubmitOutcome(values: SlotFormValues, outcome: BookingSubmitOutcome): SubmitStep {
  if (outcome.kind !== 'fields' || !timesChanged(outcome.errors)) return { outcome, values, changedTime: null }
  return { outcome, values: { ...values, time: '' }, changedTime: values.time }
}

/** Sends a complete form (BOOK-001 page API, plus acceptTerms when terms are set) and applies the answer. */
export async function sendSlotForm(token: string, values: SlotFormValues, termsRequired: boolean, post = postBooking): Promise<SubmitStep> {
  const form = { date: values.date, time: values.time, partySize: String(values.partySize), name: values.name, notes: values.notes }
  return applySubmitOutcome(values, await post(token, form, termsRequired ? { acceptTerms: values.accepted } : {}))
}

export function useBookingSlotForm({ token, termsRequired, preview, refresh }: SlotFormOptions) {
  const [values, setValues] = useState<SlotFormValues>(EMPTY_SLOT_FORM)
  const [outcome, setOutcome] = useState<BookingSubmitOutcome | null>(null)
  const [changedTime, setChangedTime] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function set<K extends keyof SlotFormValues>(key: K, value: SlotFormValues[K]) {
    if (key === 'time') setChangedTime(null)
    setValues((v) => ({ ...v, [key]: value, ...(key === 'date' && value !== v.date ? { time: '' } : {}) }))
  }

  const missing = missingStep({ ...values, termsRequired })

  async function submit() {
    if (preview || missing) return
    setSubmitting(true)
    const step = await sendSlotForm(token, values, termsRequired)
    setValues(step.values)
    setOutcome(step.outcome)
    setChangedTime(step.changedTime)
    if (step.changedTime !== null) refresh()
    setSubmitting(false)
  }

  return { values, set, outcome, changedTime, submitting, missing, submit }
}
