// BOOK-001 W3-07 (AC-15): one reminder per confirmed booking, sent once the
// booking is within 3 hours (Asia/Hong_Kong), only for bookings made at least
// 3 hours ahead, claimed before sending so overlapping runs cannot double-send.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendBookingReminders, type SendBookingRemindersDeps } from '../booking/send-booking-reminders'
import { FakeBookingCronStore, cronBooking } from '@/test-utils/fake-booking-cron'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'

// Booking 2026-11-20 19:30 HKT = 11:30Z; the window opens 16:30 HKT = 08:30Z.
const at = (iso: string) => new Date(iso)
const IN_WINDOW = at('2026-11-20T09:00:00.000Z') // 17:00 HKT
const BEFORE_WINDOW = at('2026-11-20T08:29:00.000Z') // 16:29 HKT
const AFTER_START = at('2026-11-20T11:30:00.000Z') // 19:30 HKT

let store: FakeBookingCronStore
let sender: FakeBookingSender
let settings: FakeBookingSettings

function deps(now: Date): SendBookingRemindersDeps {
  return { store, sender, settings, now: () => now }
}

beforeEach(() => {
  store = new FakeBookingCronStore([cronBooking()])
  sender = new FakeBookingSender()
  settings = new FakeBookingSettings()
  settings.restaurants.set('rest-a', { name: 'Kushiro', logoUrl: null, whatsappNumber: null })
})

describe('sendBookingReminders (AC-15)', () => {
  it('sends one reminder for a confirmed booking entering its 3h window, with the booking details', async () => {
    const result = await sendBookingReminders(deps(IN_WINDOW))
    expect(result).toMatchObject({ sent: 1 })
    expect(sender.sent).toEqual([
      {
        restaurantId: 'rest-a', phone: '+85291234567', memberId: null, kind: 'reminder',
        details: { restaurantName: 'Kushiro', name: 'Chan Tai Man', date: '2026-11-20', time: '19:30', partySize: 4 },
      },
    ])
    expect(store.rows[0].reminderSentAt).toBe(IN_WINDOW.toISOString())
  })

  it('sends nothing before the window opens or once the booking time has passed', async () => {
    await sendBookingReminders(deps(BEFORE_WINDOW))
    await sendBookingReminders(deps(AFTER_START))
    expect(sender.sent).toHaveLength(0)
    expect(store.rows[0].reminderSentAt).toBeNull()
  })

  it.each(['pending', 'declined'] as const)('never reminds a %s booking', async (status) => {
    store.rows[0].status = status
    await sendBookingReminders(deps(IN_WINDOW))
    expect(sender.sent).toHaveLength(0)
  })

  it('no reminder for a booking made less than 3h before its time', async () => {
    store.rows[0].createdAt = '2026-11-20T09:00:00.000Z' // made at 17:00 HKT for 19:30
    await sendBookingReminders(deps(at('2026-11-20T09:05:00.000Z')))
    expect(sender.sent).toHaveLength(0)
  })

  it('a booking made exactly 3h ahead still gets one', async () => {
    store.rows[0].createdAt = '2026-11-20T08:30:00.000Z'
    await sendBookingReminders(deps(IN_WINDOW))
    expect(sender.sent).toHaveLength(1)
  })

  it('two overlapping runs send it once (CAS on reminder_sent_at)', async () => {
    const [a, b] = await Promise.all([sendBookingReminders(deps(IN_WINDOW)), sendBookingReminders(deps(IN_WINDOW))])
    expect(sender.sent).toHaveLength(1)
    expect(a.sent + b.sent).toBe(1)
  })

  it('a later run does not send it again', async () => {
    await sendBookingReminders(deps(IN_WINDOW))
    await sendBookingReminders(deps(at('2026-11-20T10:00:00.000Z')))
    expect(sender.sent).toHaveLength(1)
  })

  it('a window that crosses midnight HKT finds the next-day booking', async () => {
    store.rows[0] = cronBooking({ bookingDate: '2026-11-21', bookingTime: '01:00', createdAt: '2026-11-19T00:00:00.000Z' })
    await sendBookingReminders(deps(at('2026-11-20T15:30:00.000Z'))) // 23:30 HKT on the 20th
    expect(sender.sent).toHaveLength(1)
  })

  it('counts a claimed but undelivered reminder as not delivered and does not retry it', async () => {
    sender.result = { delivered: false, reason: 'outside_window' }
    expect(await sendBookingReminders(deps(IN_WINDOW))).toMatchObject({ sent: 0, notDelivered: 1 })
    await sendBookingReminders(deps(IN_WINDOW))
    expect(sender.sent).toHaveLength(1)
  })

  it('looks the restaurant name up once per restaurant per run', async () => {
    store.rows.push(cronBooking({ id: 'b-2', phone: '+85292222222' }))
    const spy = vi.spyOn(settings, 'getRestaurant')
    await sendBookingReminders(deps(IN_WINDOW))
    expect(sender.sent).toHaveLength(2)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
