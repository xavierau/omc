import type {
  ReferrerCommission,
  CommissionStatus,
} from '@/domain/entities/referrer-commission'

export interface ReferrerCommissionRow {
  id: string
  referrer_id: string
  month: string
  tenant_id: string
  tenant_name: string
  messages_sent: number
  commission_per_message: number
  redemptions_count?: number
  commission_per_redemption?: number
  broadcast_commission?: number
  redemption_commission?: number
  total_commission: number
  status: CommissionStatus
  paid_at: string | null
  created_at: string
  updated_at: string
}

export function mapRowToCommission(
  row: ReferrerCommissionRow
): ReferrerCommission {
  return {
    id: row.id,
    referrerId: row.referrer_id,
    month: row.month,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    messagesSent: row.messages_sent,
    commissionPerMessage: row.commission_per_message,
    redemptionsCount: row.redemptions_count ?? 0,
    commissionPerRedemption: row.commission_per_redemption ?? 0,
    broadcastCommission: row.broadcast_commission ?? row.total_commission,
    redemptionCommission: row.redemption_commission ?? 0,
    totalCommission: row.total_commission,
    status: row.status,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface UpsertCommissionInput {
  referrerId: string
  month: string
  tenantId: string
  tenantName: string
  messagesSent: number
  redemptionsCount: number
  commissionPerMessage: number
  commissionPerRedemption: number
  broadcastCommission: number
  redemptionCommission: number
  totalCommission: number
}

export function mapCommissionToUpsert(
  input: UpsertCommissionInput
): Record<string, unknown> {
  return {
    referrer_id: input.referrerId,
    month: input.month,
    tenant_id: input.tenantId,
    tenant_name: input.tenantName,
    messages_sent: input.messagesSent,
    redemptions_count: input.redemptionsCount,
    commission_per_message: input.commissionPerMessage,
    commission_per_redemption: input.commissionPerRedemption,
    broadcast_commission: input.broadcastCommission,
    redemption_commission: input.redemptionCommission,
    total_commission: input.totalCommission,
  }
}
