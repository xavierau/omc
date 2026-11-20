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

export interface CrmEvent {
  id: string
  restaurantId: string
  memberId: string | null
  type: EventType
  dataJson: Record<string, unknown>
  createdAt: string
  source?: string | null
}
