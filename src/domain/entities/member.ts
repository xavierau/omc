export interface Member {
  id: string
  restaurantId: string
  phone: string
  name: string | null
  pointsBalance: number
  status: 'active' | 'unsubscribed'
  joinedAt: string
  lastVisitAt: string | null
  preferredLanguage: string | null
  // WAQ-007 cooldown-gate inputs. Set by WAQ-003 error dispatcher on
  // 131049 (PMM hit) and 131026 (recipient unreachable). Reading them at
  // send time gates marketing sends without an extra round-trip.
  pmmThrottledUntil: string | null
  unreachableAt: string | null
}
