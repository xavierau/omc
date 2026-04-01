export interface Member {
  id: string
  restaurantId: string
  phone: string
  name: string | null
  pointsBalance: number
  status: 'active' | 'unsubscribed'
  joinedAt: string
  lastVisitAt: string | null
}
