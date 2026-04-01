export type EventType =
  | 'join'
  | 'redeem'
  | 'receipt'
  | 'campaign'
  | 'points'
  | 'unsubscribe'
  | 'reward_redeem'

export interface CrmEvent {
  id: string
  restaurantId: string
  memberId: string | null
  type: EventType
  dataJson: Record<string, unknown>
  createdAt: string
}
