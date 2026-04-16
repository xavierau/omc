import { getAllTenantsUsageForMonth } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import { getRedemptionCountsByTenantForMonth } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import { listAllTenantsSummary, type TenantSummary } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { estimateCampaignCost, toHKD } from '@/domain/services/campaign-cost'
import { calculateBroadcastFee, calculateRedemptionFee } from '@/domain/services/platform-fee'
import { currentMonth, parseMonthRange } from '@/lib/month-range'

export interface TenantBillingRow {
  tenantId: string
  tenantName: string
  plan: string
  campaignsRun: number
  messagesSent: number
  estimatedCostUsd: number
  estimatedCostHkd: number
  metaCostHkd: number
  broadcastFeeHkd: number
  redemptionsCount: number
  redemptionFeeHkd: number
  totalChargeHkd: number
}

export interface BillingReport {
  month: string
  tenants: TenantBillingRow[]
  totalMessages: number
  totalCostHkd: number
  totalRedemptions: number
  totalPlatformFeeHkd: number
  totalChargeHkd: number
}

interface UsageInfo {
  campaignCount: number
  totalSent: number
}

export async function getBillingReport(
  month?: string
): Promise<BillingReport> {
  const targetMonth = month ?? currentMonth()
  const { monthStart, monthEnd } = parseMonthRange(targetMonth)

  const [tenants, usageRows, redemptionRows] = await Promise.all([
    listAllTenantsSummary(),
    getAllTenantsUsageForMonth(monthStart, monthEnd),
    getRedemptionCountsByTenantForMonth(monthStart, monthEnd),
  ])

  const usageMap = new Map(usageRows.map((r) => [r.restaurantId, r]))
  const redemptionMap = new Map(
    redemptionRows.map((r) => [r.restaurantId, r.redemptionCount])
  )

  const billingRows = tenants.map((t) =>
    toBillingRow(t, usageMap, redemptionMap)
  )

  return buildReport(targetMonth, billingRows)
}

function toBillingRow(
  tenant: TenantSummary,
  usageMap: Map<string, UsageInfo>,
  redemptionMap: Map<string, number>
): TenantBillingRow {
  const usage = usageMap.get(tenant.id)
  const sent = usage?.totalSent ?? 0
  const redemptions = redemptionMap.get(tenant.id) ?? 0
  const costUsd = sent > 0 ? estimateCampaignCost(sent) : 0
  const metaCostHkd = sent > 0 ? toHKD(costUsd) : 0
  const broadcastFeeHkd = calculateBroadcastFee(sent)
  const redemptionFeeHkd = calculateRedemptionFee(redemptions)
  const totalChargeHkd = round2(
    metaCostHkd + broadcastFeeHkd + redemptionFeeHkd
  )

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    plan: tenant.plan,
    campaignsRun: usage?.campaignCount ?? 0,
    messagesSent: sent,
    estimatedCostUsd: costUsd,
    estimatedCostHkd: metaCostHkd,
    metaCostHkd,
    broadcastFeeHkd,
    redemptionsCount: redemptions,
    redemptionFeeHkd,
    totalChargeHkd,
  }
}

function buildReport(
  month: string,
  rows: TenantBillingRow[]
): BillingReport {
  const totalMessages = rows.reduce((s, r) => s + r.messagesSent, 0)
  const totalRedemptions = rows.reduce((s, r) => s + r.redemptionsCount, 0)
  const totalCostHkd = round2(rows.reduce((s, r) => s + r.metaCostHkd, 0))
  const totalPlatformFeeHkd = round2(
    rows.reduce((s, r) => s + r.broadcastFeeHkd + r.redemptionFeeHkd, 0)
  )
  const totalChargeHkd = round2(totalCostHkd + totalPlatformFeeHkd)

  return {
    month,
    tenants: rows,
    totalMessages,
    totalCostHkd,
    totalRedemptions,
    totalPlatformFeeHkd,
    totalChargeHkd,
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
