/**
 * BOOK-001 W3 (AC-15): one pass of the reminder cron (every 5 minutes).
 *
 * Each due booking is claimed with a conditional UPDATE on
 * reminder_sent_at IS NULL BEFORE the send, so two overlapping runs remind it
 * once; a claimed reminder that fails to deliver is not retried (at most once
 * per booking). The sender never throws and logs a masked phone only.
 */
import { isReminderDue } from '@/domain/services/booking-reminder'
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingMessageSender, BookingReminderStore, BookingSettingsReader } from '@/domain/ports/booking'

/** Per run; a 5-minute cadence never has more due than this. */
export const REMINDER_BATCH_LIMIT = 500

export interface SendBookingRemindersDeps {
  store: BookingReminderStore
  sender: BookingMessageSender
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  now(): Date
}

export interface ReminderRunResult {
  candidates: number
  due: number
  sent: number
  notDelivered: number
  claimLost: number
}

type RestaurantNames = Map<string, Promise<string>>

function restaurantName(deps: SendBookingRemindersDeps, names: RestaurantNames, id: string): Promise<string> {
  if (!names.has(id)) names.set(id, deps.settings.getRestaurant(id).then((r) => r?.name ?? ''))
  return names.get(id) as Promise<string>
}

async function remind(deps: SendBookingRemindersDeps, names: RestaurantNames, b: BookingRequest) {
  if (!(await deps.store.claimReminder(b.id, deps.now()))) return 'claim_lost' as const
  const result = await deps.sender.send({
    restaurantId: b.restaurantId,
    phone: b.phone,
    memberId: b.memberId,
    kind: 'reminder',
    details: {
      restaurantName: await restaurantName(deps, names, b.restaurantId),
      name: b.name,
      date: b.bookingDate,
      time: b.bookingTime,
      partySize: b.partySize,
    },
  })
  return result.delivered ? ('sent' as const) : ('not_delivered' as const)
}

export async function sendBookingReminders(deps: SendBookingRemindersDeps): Promise<ReminderRunResult> {
  const now = deps.now()
  const candidates = await deps.store.listReminderCandidates(now, REMINDER_BATCH_LIMIT)
  // The store already applies the window (F7); re-checked here as a guard.
  const due = candidates.filter((b) => isReminderDue(b, now))
  const names: RestaurantNames = new Map()
  const result: ReminderRunResult = { candidates: candidates.length, due: due.length, sent: 0, notDelivered: 0, claimLost: 0 }
  for (const booking of due) {
    const outcome = await remind(deps, names, booking)
    if (outcome === 'sent') result.sent++
    else if (outcome === 'not_delivered') result.notDelivered++
    else result.claimLost++
  }
  return result
}
