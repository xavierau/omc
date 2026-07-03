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

export interface CrmEvent {
  id: string
  restaurantId: string
  memberId: string | null
  type: EventType
  dataJson: Record<string, unknown>
  createdAt: string
  source?: string | null
}
