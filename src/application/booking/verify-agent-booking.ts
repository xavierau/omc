/**
 * BOOK-003 (R31, R32, R44): a diner's WhatsApp text that may carry an agent
 * booking's confirm code.
 *
 * Only code-shaped tokens trigger a lookup. Promotion is one conditional
 * UPDATE bound to the SENDER's phone (from the signed webhook), the code,
 * status unverified and an unexpired window, so a code sent from another
 * number, an expired code and a replayed webhook change nothing. Only a row
 * that changed gets the "received" message and the collection statement.
 * `handled: false` means "not ours": the caller runs today's routing
 * unchanged, and nothing about why is revealed to the sender.
 * Once a row is promoted the text was ours (review G3): a failed
 * acknowledgement is logged by error name and never sends the diner to the
 * fallback menu or skips the other promoted rows.
 * BOOK-008 (R1): a promoted booking links to an EXISTING member of the same
 * restaurant with the booking phone (never before: the phone is unproven
 * while unverified). Best effort: a failed link is logged by error name and
 * staff can link by hand; no member is ever created.
 * BOOK-009 W4 (spec AC-13): when terms are set, the same free-form text also
 * carries the terms the booking stored. No new Meta template (inside the 24 h window).
 * BOOK-009 F1 (P2-2): each candidate is re-checked against the rules now
 * (`recheckAgentBookings`); only the codes that still pass are promoted.
 * BOOK-010 (spec AC-6): promotion then checks room under the date lock (rules
 * first, then room); a booking whose slot filled comes back declined 'full'
 * and the diner gets the full reply instead (agent-booking-full-reply.ts).
 * BOOK-014 W5 (spec AC-10): a candidate the restaurant's deposit rule applies
 * to becomes awaiting_deposit instead of pending (agent-booking-deposit.ts)
 * and the diner gets the payment link in this chat, not the "received"
 * message (that follows the payment). Without a deposit nothing changes.
 * A provider failure answers the fixed code `payment_unavailable` (R64).
 */
import { extractConfirmCodeCandidates } from '@/domain/services/booking-confirm-code'
import { buildCollectionStatement, collectionStatementText, termsReplyText } from '@/domain/services/poppy-documents'
import { hasPhone, MAX_PENDING_PER_PHONE, type BookingRequest, type BookingWithPhone } from '@/domain/entities/booking-request'
import type { AgentBookingStore, BookingMemberLookup, BookingMessageSender, BookingSettingsReader } from '@/domain/ports/booking'
import { promoteRoom, tellFull, type AgentBookingRoomDeps } from './agent-booking-full-reply'
import { recheckAgentBookings, type RecheckAgentBookingsDeps } from './recheck-agent-bookings'
import { holdForDeposit, splitByDeposit, type AgentCodeDepositDeps, type CodeStepMessage } from './agent-booking-deposit'
import { PAYMENT_UNAVAILABLE_TEXT } from '@/domain/value-objects/deposit-messages'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

export interface VerifyAgentBookingDeps extends Pick<RecheckAgentBookingsDeps, 'bookingLink'> {
  store: Pick<AgentBookingStore, 'promote' | 'linkMember' | 'findPromotable' | 'declineUnverified'>
  members: BookingMemberLookup
  settings: Pick<BookingSettingsReader, 'getConfig' | 'getRestaurant'>
  sender: BookingMessageSender
  /** Free text inside the window the diner's own message just opened; never throws. */
  sendText(restaurantId: string, phone: string, text: string): Promise<void>
  privacyUrl: string
  now(): Date
  /** BOOK-010: room check at promotion and the full reply; absent = BOOK-009 promotion. */
  room?: AgentBookingRoomDeps
  /** BOOK-014 W5: the deposit at the code step; absent = no deposits (BOOK-003 promotion). */
  deposit?: AgentCodeDepositDeps
}

/** `error`: BOOK-014 R64's fixed code when a deposit could not start (the hold was released). */
export interface VerifyAgentBookingResult {
  handled: boolean
  error?: 'payment_unavailable'
}

export interface InboundCodeMessage {
  restaurantId: string
  phone: string
  text: string
  wamid: string
}

/** The collection statement, then (BOOK-009 AC-13) the terms the diner accepted, only when the booking stored them (F1). */
function confirmedText(statement: string, booking: BookingRequest): string {
  return booking.termsText ? `${statement}\n\n${termsReplyText(booking.termsText)}` : statement
}

async function acknowledge(deps: VerifyAgentBookingDeps, booking: BookingWithPhone): Promise<void> {
  const restaurantName = (await deps.settings.getRestaurant(booking.restaurantId))?.name ?? ''
  await deps.sender.send({
    restaurantId: booking.restaurantId, phone: booking.phone, memberId: booking.memberId, kind: 'received',
    details: { restaurantName, name: booking.name, date: booking.bookingDate, time: booking.bookingTime, partySize: booking.partySize },
  })
  const statement = collectionStatementText(buildCollectionStatement(restaurantName, deps.privacyUrl))
  await deps.sendText(booking.restaurantId, booking.phone, confirmedText(statement, booking))
}

/** R1: only now, after promotion, does the booking phone count as the diner's. */
async function linkExistingMember(deps: VerifyAgentBookingDeps, booking: BookingWithPhone): Promise<BookingWithPhone> {
  if (booking.memberId) return booking
  try {
    const memberId = await deps.members.findMemberId(booking.restaurantId, booking.phone)
    if (memberId && (await deps.store.linkMember(booking.id, booking.restaurantId, memberId))) return { ...booking, memberId }
  } catch (err) {
    console.warn('[AgentBooking] member link failed:', { error: (err as Error).name, bookingId: booking.id })
  }
  return booking
}

async function acknowledgePromoted(deps: VerifyAgentBookingDeps, promoted: BookingRequest[], config: BookingConfig): Promise<void> {
  for (const row of promoted) {
    // BOOK-013 R19: an agent booking always has its phone (DB check); without one nothing is sent.
    if (!hasPhone(row)) continue
    if (row.status === 'declined') {
      await tellFull(deps, row, config)
      continue
    }
    const booking = await linkExistingMember(deps, row)
    try {
      await acknowledge(deps, booking)
    } catch (err) {
      console.error('[AgentBooking] acknowledge failed:', { error: (err as Error).name, bookingId: booking.id })
    }
  }
}

interface HeldSummary {
  /** Rows the deposit step changed (held or declined full). */
  changed: number
  /** Codes to promote the BOOK-003 way after all. */
  plain: string[]
  paymentUnavailable: boolean
}

/** BOOK-014 W5: each candidate that needs a deposit, one at a time (its own transaction). */
async function holdDeposits(
  deps: VerifyAgentBookingDeps & { deposit: AgentCodeDepositDeps },
  message: CodeStepMessage,
  config: BookingConfig,
  split: Awaited<ReturnType<typeof splitByDeposit>>
): Promise<HeldSummary> {
  const summary: HeldSummary = { changed: 0, plain: [], paymentUnavailable: false }
  if (split.held.length === 0) return summary
  const restaurantName = (await deps.settings.getRestaurant(message.restaurantId))?.name ?? ''
  const room = promoteRoom(deps.room, config).room
  for (const row of split.held) {
    const outcome = await holdForDeposit(deps, {
      row, message, config, account: split.account, restaurantName,
      room: room ? room({ date: row.bookingDate, time: row.bookingTime }) : null,
    })
    if (outcome.kind === 'held') {
      summary.changed += 1
      await linkExistingMember(deps, { ...outcome.booking, phone: row.phone })
      await deps.sendText(row.restaurantId, row.phone, outcome.text)
    } else if (outcome.kind === 'full') {
      summary.changed += 1
      await tellFull(deps, outcome.declined, config)
    } else if (outcome.kind === 'payment_unavailable') {
      summary.changed += 1
      summary.paymentUnavailable = true
      await deps.sendText(row.restaurantId, row.phone, PAYMENT_UNAVAILABLE_TEXT)
    } else if (outcome.kind === 'not_required' && row.confirmCode) {
      summary.plain.push(row.confirmCode)
    }
  }
  return summary
}

export async function verifyAgentBooking(deps: VerifyAgentBookingDeps, message: InboundCodeMessage): Promise<VerifyAgentBookingResult> {
  const codes = extractConfirmCodeCandidates(message.text)
  if (codes.length === 0) return { handled: false }
  const config = await deps.settings.getConfig(message.restaurantId)
  if (!config.agentBooking.enabled || config.mode !== 'simple') return { handled: false }
  const recheck = await recheckAgentBookings(deps, { ...message, codes }, config)
  const at = deps.now()
  const split = await splitByDeposit(deps.deposit, config, message.restaurantId, recheck.rows)
  const held = deps.deposit
    ? await holdDeposits({ ...deps, deposit: deps.deposit }, { ...message, codes, at }, config, split)
    : { changed: 0, plain: [], paymentUnavailable: false }
  const plain = [...split.plain, ...held.plain]
  const promoted = await deps.store.promote({
    restaurantId: message.restaurantId, phone: message.phone, codes: plain, wamid: message.wamid, at,
    maxPending: MAX_PENDING_PER_PHONE, ...promoteRoom(deps.room, config),
  })
  await acknowledgePromoted(deps, promoted, config)
  const handled = promoted.length > 0 || held.changed > 0 || recheck.refused > 0
  return held.paymentUnavailable ? { handled, error: 'payment_unavailable' } : { handled }
}
