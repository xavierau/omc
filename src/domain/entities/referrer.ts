export type ReferrerStatus = 'active' | 'inactive'

export interface Referrer {
  id: string
  name: string
  contactEmail: string
  contactPhone: string | null
  commissionPerMessageHkd: number
  commissionPerRedemptionHkd: number
  status: ReferrerStatus
  createdAt: string
  updatedAt: string
}
