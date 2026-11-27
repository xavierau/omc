/**
 * BOOK-014 W4 (spec AC-11, AC-13, AC-14, AC-5; review findings 9, 10): the
 * deposit on every staff view (badge per state, Refund / Keep / Retry / Copy
 * link), the cancel dialog's choice, the calendar totals with diners' holds,
 * the 'all' count, which bookings staff see, the browser-side answers, and
 * the repository shape (embedded deposit, the 097 staff RPCs).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))
vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { BookingRow } from '../booking-row'
import { BookingsTableDesktop } from '../bookings/bookings-table-desktop'
import { CalendarMonthGrid } from '../bookings/calendar-month-grid'
import { StaffBookingContext, depositMoveToast, depositToastFor, type StaffBookingActions } from '../bookings/use-staff-booking'
import { createStaffBooking, depositMoveOutcome, initialForm, staffSaveOutcome } from '../bookings/staff-booking-api'
import { staffDepositAmount } from '../bookings/staff-booking-fields'
import { daySummary, statusCounts } from '../bookings/booking-groups'
import { isStaffVisible, type BookingDepositView } from '@/domain/entities/booking-request'
import { depositRowActions, type NewDepositHold } from '@/domain/entities/booking-deposit'
import type { BookingItem } from '@/hooks/use-bookings'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { recordingSupabase } from '@/test-utils/recording-supabase'
import { staffBookingStore } from '@/infrastructure/supabase/repositories/staff-booking-repository'
import { toBookingRequest } from '@/infrastructure/supabase/repositories/booking-request-repository'

const deposit = (status: BookingDepositView['status']): BookingDepositView => ({
  status, amount: { amountMinor: 40000, currency: 'HKD' }, refundReason: null, decidedAt: null, holdExpiresAt: '2026-11-27T02:58:00Z',
})
const booking = (over: Partial<BookingItem> = {}): BookingItem => ({
  id: 'b1', restaurantId: 'r', memberId: null, phone: '+85291234567', name: 'Mr Lam', partySize: 4, bookingDate: '2026-11-28',
  bookingTime: '19:00', notes: null, status: 'confirmed', declineReason: null, decidedBy: 'u', decidedAt: null, source: 'staff',
  campaignId: null, createdAt: '2026-11-20T00:00:00Z', decisionMessageStatus: null, editVersion: 2, createdBy: 'u', notifyDiner: true,
  checkedInAt: null, deposit: null, ...over,
})
const actions: StaffBookingActions = {
  openNew: vi.fn(), openEdit: vi.fn(), openCancel: vi.fn(), checkIn: vi.fn(async () => {}), checkInBusy: new Set(), checkInRefused: null,
  depositMove: vi.fn(async () => {}), copyDepositLink: vi.fn(async () => {}), depositBusy: new Set(),
}
const noop = () => {}
const row = (b: BookingItem) =>
  renderToStaticMarkup(
    <StaffBookingContext.Provider value={actions}>
      <ul><BookingRow booking={b} busy={false} undelivered={false} onDecide={noop} /></ul>
    </StaffBookingContext.Provider>
  )

describe('AC-14: one deposit state on every row that has one', () => {
  it.each(['awaiting', 'paid', 'refund_pending', 'refunded', 'kept', 'refund_failed'] as const)('%s, with the amount', (state) => {
    const html = row(booking({ deposit: deposit(state), status: state === 'awaiting' ? 'awaiting_deposit' : 'cancelled' }))
    expect(html).toContain('data-testid="booking-deposit-badge-b1"')
    expect(html).toContain(`data-state="${state}"`)
    expect(html).toContain(`bookings.deposit.state.${state}:{&quot;amount&quot;:&quot;HK$400&quot;}`)
  })

  it('no deposit, no badge', () => {
    expect(row(booking())).not.toContain('booking-deposit-badge')
  })

  it('the table view and the calendar chip show it too', () => {
    const b = booking({ status: 'awaiting_deposit', deposit: deposit('awaiting') })
    const table = renderToStaticMarkup(
      <StaffBookingContext.Provider value={actions}>
        <BookingsTableDesktop groups={[{ date: b.bookingDate, bookings: [b] }]} today="2026-11-26" busyIds={new Set()} undelivered={new Set()} onDecide={noop} />
      </StaffBookingContext.Provider>
    )
    expect(table).toContain('data-testid="booking-deposit-badge-b1"')
    const grid = renderToStaticMarkup(<CalendarMonthGrid bookings={[b]} selected="2026-11-28" today="2026-11-26" onSelect={noop} />)
    expect(grid).toContain('data-testid="booking-chip-b1-deposit"')
  })
})

describe('AC-12 / AC-13: what each row offers', () => {
  it.each(['cancelled', 'no_show'] as const)('%s + paid: "Deposit held HK$400" with Refund and Keep', (status) => {
    const html = row(booking({ status, deposit: deposit('paid') }))
    expect(html).toContain('bookings.deposit.held:{&quot;amount&quot;:&quot;HK$400&quot;}')
    expect(html).toContain('data-testid="booking-row-b1-refund"')
    expect(html).toContain('data-testid="booking-row-b1-keep"')
  })

  it('declined + paid (the automatic refund never started): Refund only', () => {
    const html = row(booking({ status: 'declined', deposit: deposit('paid') }))
    expect(html).toContain('booking-row-b1-refund"')
    expect(html).not.toContain('booking-row-b1-keep')
  })

  it('refund failed: Retry; refunded / kept: nothing more to choose', () => {
    expect(row(booking({ status: 'declined', deposit: deposit('refund_failed') }))).toContain('data-testid="booking-row-b1-refund-retry"')
    for (const s of ['refunded', 'kept'] as const) expect(row(booking({ status: 'cancelled', deposit: deposit(s) }))).not.toContain('deposit-actions')
  })

  it('a confirmed (going ahead) paid booking offers no Refund / Keep', () => {
    expect(depositRowActions(booking({ deposit: deposit('paid') }))).toEqual({ held: false, refund: false, keep: false, retry: false, copyLink: false })
  })

  it('a staff booking awaiting its deposit: Copy link (a diner hold never reaches a row)', () => {
    expect(row(booking({ status: 'awaiting_deposit', deposit: deposit('awaiting') }))).toContain('data-testid="booking-row-b1-deposit-copy-link"')
    expect(depositRowActions(booking({ status: 'awaiting_deposit', source: 'chat', deposit: deposit('awaiting') })).copyLink).toBe(false)
  })
})

describe('visibility and counts (spec AC-5, AC-11; review findings 9, 10)', () => {
  it('a diner hold and a lapsed one stay hidden; a staff-made hold is shown', () => {
    expect(isStaffVisible({ status: 'awaiting_deposit', source: 'chat' })).toBe(false)
    expect(isStaffVisible({ status: 'awaiting_deposit', source: 'agent' })).toBe(false)
    expect(isStaffVisible({ status: 'lapsed', source: 'staff' })).toBe(false)
    expect(isStaffVisible({ status: 'unverified', source: 'agent' })).toBe(false)
    expect(isStaffVisible({ status: 'awaiting_deposit', source: 'staff' })).toBe(true)
  })

  it("'all' counts exactly the rows staff see (hidden ones skipped in the same loop)", () => {
    const list = [
      booking({ id: '1', status: 'confirmed' }),
      booking({ id: '2', status: 'awaiting_deposit', deposit: deposit('awaiting') }),
      booking({ id: '3', status: 'awaiting_deposit', source: 'chat' }),
      booking({ id: '4', status: 'lapsed' }),
      booking({ id: '5', status: 'unverified', source: 'agent' }),
    ]
    const counts = statusCounts(list)
    expect(counts.all).toBe(list.filter(isStaffVisible).length)
    expect(counts).toMatchObject({ all: 2, confirmed: 1 })
  })

  it('day guests count a staff hold (listed) and diners\' holds (not listed), as booking_room_refusal does', () => {
    const day = [booking({ partySize: 4 }), booking({ id: '2', partySize: 2, status: 'awaiting_deposit', deposit: deposit('awaiting') })]
    expect(daySummary(day, 3).guests).toBe(9)
    const grid = renderToStaticMarkup(<CalendarMonthGrid bookings={day} selected="2026-11-28" today="2026-11-26" onSelect={noop} holds={{ '2026-11-28': 3 }} />)
    expect(grid).toContain('bookings.views.guests:{&quot;count&quot;:9}')
  })
})

describe('browser-side answers', () => {
  it('create: the deposit flag is sent; 201 with paymentUrl; 503 payment_unavailable', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ booking: booking(), message: 'not_delivered', paymentUrl: 'https://a.test/p/x' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await createStaffBooking({ ...initialForm('2026-11-28'), phone: '91234567', name: 'A', time: '19:00', requireDeposit: false })
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ requireDeposit: false })
    expect(out).toMatchObject({ kind: 'saved', paymentUrl: 'https://a.test/p/x', message: 'not_delivered' })
    vi.unstubAllGlobals()
    expect(staffSaveOutcome(503, { error: 'payment_unavailable' })).toEqual({ kind: 'payment_unavailable' })
    expect(initialForm('2026-11-28').requireDeposit).toBe(true)
  })

  it('toasts: link sent vs not sent (Copy link); refund / keep outcomes', () => {
    expect(depositToastFor('delivered')).toBe('deposit_sent')
    for (const m of ['not_delivered', 'none', 'throttled'] as const) expect(depositToastFor(m)).toBe('deposit_not_sent')
    expect(depositMoveToast(depositMoveOutcome(200, { deposit: deposit('refunded') }))).toBe('refunded')
    expect(depositMoveToast(depositMoveOutcome(200, { deposit: deposit('refund_failed') }))).toBe('refund_failed')
    expect(depositMoveToast(depositMoveOutcome(200, { deposit: deposit('kept') }))).toBe('kept')
    expect(depositMoveToast(depositMoveOutcome(409, { error: 'conflict' }))).toBe('deposit_conflict')
    expect(depositMoveToast(depositMoveOutcome(500, null))).toBe('deposit_failed')
  })

  it('the form shows "Require deposit" with the amount the rule asks of the party (display only)', () => {
    const rule = { mode: 'per_guest' as const, amount: 100, fromPartySize: 4, currency: 'HKD' }
    expect(staffDepositAmount(rule, 4)).toEqual({ amountMinor: 40000, currency: 'HKD' })
    expect(staffDepositAmount(rule, 3)).toBeNull()
    expect(staffDepositAmount(null, 6)).toBeNull()
  })

  it('every new string exists in zh-HK and en', () => {
    const keys = (o: Record<string, unknown>, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]))
    expect(keys(zhHK.bookings.deposit).sort()).toEqual(keys(en.bookings.deposit).sort())
    expect(zhHK.bookings.status.awaiting_deposit).toBeTruthy()
    expect(zhHK.bookingSettings.templates.kind.deposit_request).toBeTruthy()
  })
})

describe('repository shape (migration 097)', () => {
  const MIGRATION = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/097_booking_deposits.sql'), 'utf8')
  const argsOf = (fn: string) => {
    const m = new RegExp(`FUNCTION public\\.${fn}\\(([^)]*)\\)`, 's').exec(MIGRATION)
    return (m?.[1].match(/p_[a-z_]+/g) ?? []).sort()
  }

  it('the embedded deposit maps onto the booking (object or one-row array); none -> null', () => {
    const base = {
      id: 'b', restaurant_id: 'r', member_id: null, phone: null, name: 'A', party_size: 2, booking_date: '2026-11-28', booking_time: '19:00:00',
      notes: null, status: 'cancelled', decline_reason: null, decided_by: null, decided_at: null, source: 'staff', campaign_id: null,
      created_at: 'x', decision_message_status: null, edit_version: 1,
    } as const
    const d = { status: 'paid', amount_minor: 40000, currency: 'HKD', refund_reason: null, decided_at: null, hold_expires_at: 'h' }
    expect(toBookingRequest({ ...base, booking_deposits: d } as never).deposit).toEqual({ status: 'paid', amount: { amountMinor: 40000, currency: 'HKD' }, refundReason: null, decidedAt: null, holdExpiresAt: 'h' })
    expect(toBookingRequest({ ...base, booking_deposits: [d] } as never).deposit?.status).toBe('paid')
    expect(toBookingRequest({ ...base, booking_deposits: null } as never).deposit).toBeNull()
  })

  it('a waived create calls staff_create_booking_waiving_deposit with the amount; every argument exists in 097', async () => {
    const rec = recordingSupabase([{ data: [{ id: 'b', restaurant_id: 'r', status: 'confirmed', booking_time: '19:00:00' }] }])
    vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
    const input = { phone: '+85291234567', name: 'A', partySize: 2, date: '2026-11-28', time: '19:00', notes: null, notify: true, override: false }
    await staffBookingStore.create({ restaurantId: 'r', memberId: null, input, actorUserId: 'u', at: new Date(), brokenRules: [], waivedDeposit: { amountMinor: 200, currency: 'HKD' } })
    expect(rec.queries[0].table).toBe('rpc:staff_create_booking_waiving_deposit')
    const args = rec.queries[0].calls[0][1] as Record<string, unknown>
    expect(args).toMatchObject({ p_amount_minor: 200, p_currency: 'HKD', p_actor: 'u', p_restaurant_id: 'r' })
    expect(Object.keys(args).sort()).toEqual(argsOf('staff_create_booking_waiving_deposit'))
  })

  it('a deposit create calls staff_create_deposit_booking with the deposit row; every argument exists in 097', async () => {
    const row = { id: 'b', restaurant_id: 'r', status: 'awaiting_deposit', booking_time: '19:00:00' }
    const dep = {
      id: 'd', restaurant_id: 'r', booking_id: 'b', provider_code: 'test', account_id: 'a', provider_account_id: 'acct', amount_minor: 200,
      currency: 'HKD', status: 'awaiting', hold_expires_at: 'h', provider_session_id: null, session_url: null, provider_payment_ref: null,
      paid_at: null, refund_ref: null, refund_reason: null, refund_attempts: 0, decided_by: null, decided_at: null, created_at: 'c',
    }
    const rec = recordingSupabase([{ data: { row, deposit: dep } }, { data: { ...row, booking_deposits: null } }, { data: [] }])
    vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
    const input = { phone: '+85291234567', name: 'A', partySize: 2, date: '2026-11-28', time: '19:00', notes: null, notify: true, override: false }
    const hold: NewDepositHold = { id: 'd', providerCode: 'test', accountId: 'a', providerAccountId: 'acct', amount: { amountMinor: 200, currency: 'HKD' }, holdExpiresAt: 'h', linkTokenHash: 'f'.repeat(64) }
    const out = await staffBookingStore.createAwaitingDeposit({ restaurantId: 'r', memberId: null, input, actorUserId: 'u', at: new Date(), brokenRules: [] }, hold)
    expect(rec.queries[0].table).toBe('rpc:staff_create_deposit_booking')
    const args = rec.queries[0].calls[0][1] as Record<string, unknown>
    expect(Object.keys(args).sort()).toEqual(argsOf('staff_create_deposit_booking'))
    expect(args.p_deposit).toMatchObject({ id: 'd', amount_minor: 200, currency: 'HKD', link_token_hash: 'f'.repeat(64) })
    expect(out.deposit).toMatchObject({ id: 'd', status: 'awaiting' })
    // The read-back is the staff-visible lookup: scoped by restaurant, a staff-made hold allowed.
    const filters = rec.queries[1].calls.map((c) => c.join(':'))
    expect(filters).toContain('eq:restaurant_id:r')
    expect(filters).toContain('or:status.neq.awaiting_deposit,source.eq.staff')
  })

  it('deposit_events: a waived event names the booking (deposit_id may be NULL only for it)', () => {
    expect(MIGRATION).toMatch(/deposit_id\s+UUID REFERENCES booking_deposits/)
    expect(MIGRATION).toMatch(/CHECK \(deposit_id IS NOT NULL OR \(event_type = 'waived' AND booking_id IS NOT NULL\)\)/)
  })
})
