export type CommissionStatus = 'pending' | 'paid'

export interface ReferrerCommission {
  id: string
  referrerId: string
  month: string
  tenantId: string
  tenantName: string
  messagesSent: number
  commissionPerMessage: number
  redemptionsCount: number
  commissionPerRedemption: number
  broadcastCommission: number
  redemptionCommission: number
  totalCommission: number
  status: CommissionStatus
  paidAt: string | null
  createdAt: string
  updatedAt: string
}
