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

export interface CrmEvent {
  id: string
  restaurantId: string
  memberId: string | null
  type: EventType
  dataJson: Record<string, unknown>
  createdAt: string
  source?: string | null
}
