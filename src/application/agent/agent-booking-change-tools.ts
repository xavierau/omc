/**
 * AGENT-003 R20–R24: the diner changes or cancels their own booking by chat.
 *
 * - `list_my_bookings()` (R20): the job phone's UPCOMING bookings at the job
 *   restaurant (pending + confirmed, today or later), minimal fields, each
 *   with a short `ref` (the first 8 characters of its id).
 * - `propose_booking_change(bookingRef, date?, time?, partySize?)` and
 *   `propose_booking_cancel(bookingRef)` (R21): `bookingRef` is the only id
 *   the model may pass, and it is looked up INSIDE the diner's own upcoming
 *   bookings (a query scoped by restaurant AND phone), never fetched first and
 *   compared after. New values go through `parseBookingSubmission` (R13).
 *   They store the one proposal of the conversation (R22) and change nothing.
 * - `confirm_booking_change()` / `confirm_booking_cancel()` (R22): no
 *   arguments, the R15 gate. A change becomes a pending change request linked
 *   to the original, which staff decide in 訂座 (R23); the original stays as
 *   it is until then. A cancel is direct: the booking (and any open change
 *   request of it) becomes `cancelled` by `diner_ai`, and the diner gets a
 *   short in-window text (R24).
 */
import { parseBookingSubmission, type BookingSubmission } from '@/domain/services/booking-submission'
import type { DinerBooking } from '@/domain/entities/booking-request'
import type { AgentToolDeclaration, AgentToolOutput } from '@/domain/ports/agent-model'
import type { AgentToolName } from '@/domain/value-objects/agent-config'
import { bookingRulesAt, notifyReceived } from '@/application/booking/submit-booking-request'
import { hkToday, saveProposal, takeProposal, type BookingCall } from './agent-booking-gate'

export type AgentChangeToolName = Extract<
  AgentToolName,
  'list_my_bookings' | 'propose_booking_change' | 'confirm_booking_change' | 'propose_booking_cancel' | 'confirm_booking_cancel'
>
export const CHANGE_TOOL_NAMES: readonly AgentChangeToolName[] = [
  'list_my_bookings',
  'propose_booking_change',
  'confirm_booking_change',
  'propose_booking_cancel',
  'confirm_booking_cancel',
]

export const BOOKING_REF_LENGTH = 8
const REF_SHAPE = /^[0-9a-f-]{8,36}$/

const BOOKING_REF_PARAM = {
  type: 'string' as const,
  description: 'The ref of one of the diner’s bookings, exactly as list_my_bookings returned it.',
}

export const CHANGE_TOOL_DECLARATIONS: Record<AgentChangeToolName, AgentToolDeclaration> = {
  list_my_bookings: {
    name: 'list_my_bookings',
    description:
      "List the upcoming bookings of the diner you are talking to at this restaurant (date, time, party size, status, ref). Use it before changing or cancelling. Takes no arguments; it only ever returns this diner's own bookings.",
  },
  propose_booking_change: {
    name: 'propose_booking_change',
    description:
      'Check a change to one of the diner’s upcoming bookings (new date, time and/or party size). It changes nothing: read the old and new details back and ask the diner to confirm. A confirmed change becomes a request that restaurant staff accept or decline; the original booking stays until they accept.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef: BOOKING_REF_PARAM,
        date: { type: 'string', description: 'New date in Hong Kong as YYYY-MM-DD; leave out to keep it.' },
        time: { type: 'string', description: 'New arrival time as HH:MM, 24-hour; leave out to keep it.' },
        partySize: { type: 'integer', description: 'New number of people; leave out to keep it.' },
      },
      required: ['bookingRef'],
    },
  },
  confirm_booking_change: {
    name: 'confirm_booking_change',
    description:
      'Send the change you proposed with propose_booking_change to the restaurant, only after the diner agreed to your read-back in a later message. Takes no arguments. Tell the diner staff will confirm the new time and their original booking stays until then.',
  },
  propose_booking_cancel: {
    name: 'propose_booking_cancel',
    description:
      'Check the cancellation of one of the diner’s upcoming bookings. It cancels nothing: read the booking back and ask the diner to confirm they want to cancel it.',
    parameters: { type: 'object', properties: { bookingRef: BOOKING_REF_PARAM }, required: ['bookingRef'] },
  },
  confirm_booking_cancel: {
    name: 'confirm_booking_cancel',
    description:
      'Cancel the booking you proposed with propose_booking_cancel, only after the diner agreed in a later message. Takes no arguments.',
  },
}

const refOf = (b: DinerBooking) => b.id.slice(0, BOOKING_REF_LENGTH)
const slotOf = (b: { bookingDate: string; bookingTime: string; partySize: number }) => ({
  date: b.bookingDate,
  time: b.bookingTime,
  partySize: b.partySize,
})

const NOT_FOUND: AgentToolOutput = {
  error: 'not_found',
  note: 'No upcoming booking of this diner has that ref. Call list_my_bookings and use one of its refs.',
}

function upcoming(call: BookingCall): Promise<DinerBooking[]> {
  return call.booking.diner.listUpcoming(call.key.restaurantId, call.key.phone, hkToday(call))
}

/** R21: the ref resolved inside the diner's own upcoming bookings (scoped query); ambiguous or unknown → null. */
async function resolveRef(call: BookingCall, raw: unknown): Promise<{ target: DinerBooking; all: DinerBooking[] } | null> {
  const ref = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!REF_SHAPE.test(ref)) return null
  const all = await upcoming(call)
  const hits = all.filter((b) => b.id.startsWith(ref))
  return hits.length === 1 ? { target: hits[0], all } : null
}

async function listMyBookings(call: BookingCall): Promise<AgentToolOutput> {
  const all = await upcoming(call)
  const refs = new Map(all.map((b) => [b.id, refOf(b)]))
  return {
    bookings: all.map((b) => ({
      ref: refOf(b),
      ...slotOf(b),
      status: b.status,
      ...(b.replacesBookingId ? { changeRequestFor: refs.get(b.replacesBookingId) ?? 'another booking' } : {}),
    })),
  }
}

function changedSubmission(call: BookingCall, target: DinerBooking, args: Record<string, unknown>) {
  const body = {
    date: args.date ?? target.bookingDate,
    time: args.time ?? target.bookingTime,
    partySize: args.partySize ?? target.partySize,
    name: target.name ?? '-',
    notes: target.notes,
  }
  return parseBookingSubmission(body, bookingRulesAt(call.now(), call.booking.config.maxPartySize))
}

const sameSlot = (s: BookingSubmission, b: DinerBooking) =>
  s.date === b.bookingDate && s.time === b.bookingTime && s.partySize === b.partySize

async function proposeChange(call: BookingCall, args: Record<string, unknown>): Promise<AgentToolOutput> {
  const found = await resolveRef(call, args.bookingRef)
  if (!found) return NOT_FOUND
  const { target, all } = found
  if (target.replacesBookingId) return { error: 'not_changeable', note: 'This is already a change request waiting for staff.' }
  if (all.some((b) => b.replacesBookingId === target.id)) {
    return { error: 'change_already_pending', note: 'A change of this booking is already waiting for staff.' }
  }
  const parsed = changedSubmission(call, target, args)
  if (!parsed.ok) return { error: 'invalid', fields: parsed.errors, note: 'Ask the diner to correct these details.' }
  if (sameSlot(parsed.submission, target)) return { error: 'nothing_to_change', note: 'Ask the diner what they want to change.' }
  if (!(await saveProposal(call, { kind: 'change', bookingId: target.id, booking: parsed.submission }))) return { error: 'lookup_failed' }
  return {
    proposed: true,
    from: slotOf(target),
    to: { date: parsed.submission.date, time: parsed.submission.time, partySize: parsed.submission.partySize },
    note: 'Nothing is changed yet. Read the old and new details back and ask the diner to confirm. Call confirm_booking_change only after they agree in their next message.',
  }
}

async function confirmChange(call: BookingCall): Promise<AgentToolOutput> {
  const { key, booking } = call
  const taken = await takeProposal(call, 'change')
  if (!taken.ok) return taken.output
  // The original must still be the diner's open, upcoming booking.
  const target = (await upcoming(call)).find((b) => b.id === taken.proposal.bookingId && !b.replacesBookingId)
  if (!target) return NOT_FOUND
  const parsed = parseBookingSubmission({ ...taken.proposal.booking }, bookingRulesAt(call.now(), booking.config.maxPartySize))
  if (!parsed.ok) return { error: 'invalid', fields: parsed.errors, note: 'Ask the diner for new details and propose again.' }
  const s = parsed.submission
  let created
  try {
    created = await booking.requests.insert({
      restaurantId: key.restaurantId,
      memberId: target.memberId,
      phone: key.phone,
      name: s.name,
      partySize: s.partySize,
      bookingDate: s.date,
      bookingTime: s.time,
      notes: s.notes,
      source: 'agent',
      campaignId: null,
      token: null,
      replacesBookingId: target.id,
    })
  } catch (err) {
    // R23: one open change request per booking (unique index).
    if (/one_pending_change|duplicate key/.test((err as Error).message)) {
      return { error: 'change_already_pending', note: 'A change of this booking is already waiting for staff.' }
    }
    throw err
  }
  await notifyReceived(booking, created).catch(() => false)
  return {
    changeRequested: true,
    status: 'pending',
    note: 'The change request is sent. Tell the diner staff will confirm the new time by WhatsApp, and their original booking stays until then.',
  }
}

async function proposeCancel(call: BookingCall, args: Record<string, unknown>): Promise<AgentToolOutput> {
  const found = await resolveRef(call, args.bookingRef)
  if (!found) return NOT_FOUND
  if (!(await saveProposal(call, { kind: 'cancel', bookingId: found.target.id }))) return { error: 'lookup_failed' }
  return {
    proposed: true,
    booking: { ...slotOf(found.target), status: found.target.status },
    note: 'Nothing is cancelled yet. Read the booking back and ask the diner to confirm the cancellation. Call confirm_booking_cancel only after they agree in their next message.',
  }
}

/** R24: the short in-window confirmation, bilingual (the diner just messaged, no template needed). */
export function cancelledText(b: { bookingDate: string; bookingTime: string; partySize: number }): string {
  return (
    `已取消你 ${b.bookingDate} ${b.bookingTime}（${b.partySize} 位）的訂座。\n` +
    `Your booking for ${b.partySize} on ${b.bookingDate} at ${b.bookingTime} is cancelled.`
  )
}

async function confirmCancel(call: BookingCall): Promise<AgentToolOutput> {
  const { key, booking } = call
  const taken = await takeProposal(call, 'cancel')
  if (!taken.ok) return taken.output
  const target = (await upcoming(call)).find((b) => b.id === taken.proposal.bookingId)
  if (!target) return NOT_FOUND
  const ids = await booking.diner.cancelByDiner({
    restaurantId: key.restaurantId,
    phone: key.phone,
    id: target.id,
    today: hkToday(call),
    at: call.now(),
  })
  if (!ids.includes(target.id)) return NOT_FOUND
  const texted = await booking.notifyText(key.restaurantId, key.phone, cancelledText(target)).catch(() => false)
  return {
    cancelled: true,
    booking: slotOf(target),
    note: texted
      ? 'Cancelled. The diner already got a short confirmation text; reply briefly.'
      : 'Cancelled. Tell the diner the booking is cancelled.',
  }
}

export async function runChangeTool(name: AgentChangeToolName, call: BookingCall, args: Record<string, unknown>): Promise<AgentToolOutput> {
  switch (name) {
    case 'list_my_bookings':
      return listMyBookings(call)
    case 'propose_booking_change':
      return proposeChange(call, args)
    case 'confirm_booking_change':
      return confirmChange(call)
    case 'propose_booking_cancel':
      return proposeCancel(call, args)
    case 'confirm_booking_cancel':
      return confirmCancel(call)
  }
}
