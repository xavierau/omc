export type CommissionStatus = 'pending' | 'paid'

export interface ReferrerCommission {
  id: string
  referrerId: string
  month: string
  tenantId: string
  tenantName: string
  messagesSent: number
  commissionPerMessage: number
  totalCommission: number
  status: CommissionStatus
  paidAt: string | null
  createdAt: string
  updatedAt: string
}
