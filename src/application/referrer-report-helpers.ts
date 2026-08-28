import type { UpsertCommissionInput } from '@/infrastructure/supabase/repositories/referrer-commission-mapper'
import type { CommissionRow } from './generate-referrer-report'

export function toUpsertInputs(
  commissions: CommissionRow[],
  month: string
): UpsertCommissionInput[] {
  return commissions.map((c) => toUpsertInput(c, month))
}

function toUpsertInput(c: CommissionRow, month: string): UpsertCommissionInput {
  // totalCommission is intentionally omitted: the DB computes it as a
  // GENERATED STORED column (migration 026).
  return {
    referrerId: c.referrerId,
    month,
    tenantId: c.tenantId,
    tenantName: c.tenantName,
    messagesSent: c.messagesSent,
    redemptionsCount: c.redemptionsCount,
    commissionPerMessage: c.commissionPerMessage,
    commissionPerRedemption: c.commissionPerRedemption,
    broadcastCommission: c.broadcastCommission,
    redemptionCommission: c.redemptionCommission,
  }
}

export function sumBy<T>(items: T[], fn: (item: T) => number): number {
  return roundTwo(items.reduce((s, item) => s + fn(item), 0))
}

export function roundTwo(n: number): number {
  return Math.round(n * 100) / 100
}
