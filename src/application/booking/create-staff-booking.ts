/**
 * BOOK-013 S1: staff add a booking (a phone or walk-up diner).
 *
 * The booking starts confirmed, source 'staff', created by the user, with an
 * events row (R9) in one transaction. Fields are
 * validated first and never overridable (R7); then the booking rules: broken
 * ones answer `rules` until staff book anyway (owner decision 3, AC-3). The
 * member link is an EXISTING member of this restaurant by phone, never a new
 * one (R17, BOOK-008). With Notify on, the diner gets the confirmation
 * (AC-1); off, no message and no reminder (AC-2). Decision 9 (AC-26): with
 * no phone the booking links no member and Notify is off (no message ever).
 *
 * BOOK-014 W4 (spec AC-11, R60): when the restaurant's deposit rule applies
 * to the party, the account can take charges and a phone is given, the
 * deposit is required unless staff turn it off. Required: W1's startDeposit
 * (the one money entry, staff hold) saves the booking awaiting_deposit with
 * its deposit, and the diner gets the deposit request (template with the /p
 * link button) when Notify is on; paid -> confirmed (097). Turned off: the
 * booking is created as before with a 'waived' deposit event by the user.
 * No phone: no deposit (a link needs somewhere to go).
 */
import { depositViewOf } from '@/domain/entities/booking-deposit'
import type { MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import { depositRequested, parseStaffBookingInput, type StaffBookingInput } from '@/domain/services/staff-booking-input'
import { brokenRuleCodes } from '@/domain/services/staff-booking-rules'
import { hongKongTime, hongKongToday } from '@/domain/services/booking-submission'
import type { StaffCreateArgs } from '@/domain/ports/staff-booking'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { Money } from '@/domain/value-objects/money'
import { plannedDeposit, startDeposit } from '@/application/payments/start-deposit'
import {
  bookingIsOff,
  clockAt,
  messageDiner,
  rulesFor,
  withOutcome,
  type StaffBookingDeps,
  type StaffBookingResult,
  type StaffDepositDeps,
} from './staff-booking-shared'

export interface CreateStaffBookingInput {
  restaurantId: string
  userId: string
  body: unknown
}

interface DepositPlan {
  deposit: StaffDepositDeps
  account: MerchantPaymentAccount
  amount: Money
}

/** The deposit the rule asks of this party, or null (no deposits wired, no phone, rule off or below N, account not chargeable). */
async function depositPlan(deps: StaffBookingDeps, restaurantId: string, config: BookingConfig, form: StaffBookingInput): Promise<DepositPlan | null> {
  if (!deps.deposit || form.phone === null) return null
  const account = await deps.deposit.accounts.findForRestaurant(restaurantId)
  const amount = plannedDeposit(config.deposit, account, form.partySize)
  return amount && account ? { deposit: deps.deposit, account, amount } : null
}

/** "2026-11-28 19:05" in Hong Kong: when the hold ends, as the deposit request states it. */
const hongKongMoment = (iso: string) => `${hongKongToday(new Date(iso))} ${hongKongTime(new Date(iso))}`

/** The token of a `<app>/p/<token>` link (the template button's variable). */
const linkTokenOf = (paymentUrl: string) => paymentUrl.slice(paymentUrl.lastIndexOf('/p/') + 3)

async function createConfirmed(deps: StaffBookingDeps, args: StaffCreateArgs): Promise<StaffBookingResult> {
  const booking = await deps.store.create(args)
  const message = await messageDiner(deps, booking, 'confirmed', args.input.notify)
  return { ok: true, booking: withOutcome(booking, message), message }
}

async function createAwaitingDeposit(deps: StaffBookingDeps, args: StaffCreateArgs & { input: { phone: string } }, config: BookingConfig, plan: DepositPlan): Promise<StaffBookingResult> {
  const restaurant = await deps.settings.getRestaurant(args.restaurantId)
  const started = await startDeposit(plan.deposit.start, {
    restaurantId: args.restaurantId,
    rule: config.deposit,
    account: plan.account,
    partySize: args.input.partySize,
    holder: 'staff',
    restaurantName: restaurant?.name ?? '',
    bookingDate: args.input.date,
    bookingTime: args.input.time,
    insertBooking: async (hold) => ({ ok: true as const, ...(await deps.store.createAwaitingDeposit(args, hold)) }),
  })
  // The account stopped taking charges between the plan and the start: the booking is taken without a deposit (spec AC-4).
  if (started.kind === 'not_required' || started.kind === 'refused') return createConfirmed(deps, args)
  if (started.kind === 'payment_unavailable') return { ok: false, reason: 'payment_unavailable' }
  const booking = { ...started.booking, deposit: depositViewOf(started.deposit) }
  const message = await messageDiner(deps, booking, 'deposit_request', args.input.notify, {
    depositRequest: {
      amount: started.amount,
      holdUntil: hongKongMoment(started.expiresAt),
      linkUrl: started.paymentUrl,
      linkToken: linkTokenOf(started.paymentUrl),
    },
  })
  return { ok: true, booking, message, paymentUrl: started.paymentUrl }
}

export async function createStaffBooking(deps: StaffBookingDeps, input: CreateStaffBookingInput): Promise<StaffBookingResult> {
  const config = await deps.settings.getConfig(input.restaurantId)
  if (bookingIsOff(config)) return { ok: false, reason: 'booking_off' }
  const parsed = parseStaffBookingInput(input.body, {
    maxPartySize: config.maxPartySize,
    clock: clockAt(deps.now()),
    normalizePhone: deps.normalizePhone,
  })
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors }
  const form = parsed.input
  const rules = await rulesFor(deps, input.restaurantId, config, form)
  if (rules.length > 0 && !form.override) return { ok: false, reason: 'rules', rules }

  const args: StaffCreateArgs = {
    restaurantId: input.restaurantId,
    memberId: form.phone === null ? null : await deps.members.findMemberId(input.restaurantId, form.phone),
    input: form,
    actorUserId: input.userId,
    at: deps.now(),
    brokenRules: brokenRuleCodes(rules),
  }
  const plan = await depositPlan(deps, input.restaurantId, config, form)
  if (!plan || form.phone === null) return createConfirmed(deps, args)
  if (!depositRequested(input.body)) return createConfirmed(deps, { ...args, waivedDeposit: plan.amount })
  return createAwaitingDeposit(deps, { ...args, input: { ...form, phone: form.phone } }, config, plan)
}
