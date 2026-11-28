export type EventType =
  | 'join'
  | 'redeem'
  | 'receipt'
  | 'campaign'
  | 'points'
  | 'unsubscribe'
  | 'reward_redeem'
  | 'pos_transaction'
  | 'pos_refund'
  | 'pos_customer_link'
  | 'integration_error'
  | 'whatsapp_error'
  | 'onboarding_phase_advanced'
  | 'consent_imported'
  | 'consent_granted'
  | 'consent_revoked'
  | 'consent_expired'
  | 'stamp'
  | 'stamp_reversal'
  | 'reachability_restored'
  /** BOOK-008 R4 (migration 088): staff linked, relinked or unlinked a booking's member. */
  | 'booking.member_relinked'
  /** BOOK-013 R9 (migration 095): staff create / edit / cancel and check-in, written by the RPCs. */
  | 'booking.staff_created'
  | 'booking.staff_edited'
  | 'booking.staff_cancelled'
  | 'booking.checked_in'
  | 'booking.check_in_undone'

export interface CrmEvent {
  id: string
  restaurantId: string
  memberId: string | null
  type: EventType
  dataJson: Record<string, unknown>
  createdAt: string
  source?: string | null
}
