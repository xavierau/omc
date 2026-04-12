import { getAllTenantsUsageForMonth } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import { listAllTenantsSummary, type TenantSummary } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { estimateCampaignCost, toHKD } from '@/domain/services/campaign-cost'
import { currentMonth, parseMonthRange } from '@/domain/services/month-range'

export interface TenantBillingRow {
  tenantId: string
  tenantName: string
  plan: string
  campaignsRun: number
  messagesSent: number
  estimatedCostUsd: number
  estimatedCostHkd: number
}

export interface BillingReport {
  month: string
  tenants: TenantBillingRow[]
  totalMessages: number
  totalCostHkd: number
}

export async function getBillingReport(
  month?: string
): Promise<BillingReport> {
  const targetMonth = month ?? currentMonth()
  const { monthStart, monthEnd } = parseMonthRange(targetMonth)

  const [tenants, usageRows] = await Promise.all([
    listAllTenantsSummary(),
    getAllTenantsUsageForMonth(monthStart, monthEnd),
  ])

  const usageMap = new Map(usageRows.map((r) => [r.restaurantId, r]))
  const billingRows = tenants.map((t) => toBillingRow(t, usageMap))
  const totalMessages = billingRows.reduce((s, r) => s + r.messagesSent, 0)
  const totalCostHkd = sumHkdCost(billingRows)

  return { month: targetMonth, tenants: billingRows, totalMessages, totalCostHkd }
}

interface UsageInfo {
  campaignCount: number
  totalSent: number
}

function toBillingRow(
  tenant: TenantSummary,
  usageMap: Map<string, UsageInfo>
): TenantBillingRow {
  const usage = usageMap.get(tenant.id)
  const sent = usage?.totalSent ?? 0
  const costUsd = sent > 0 ? estimateCampaignCost(sent) : 0
  const costHkd = sent > 0 ? toHKD(costUsd) : 0

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    plan: tenant.plan,
    campaignsRun: usage?.campaignCount ?? 0,
    messagesSent: sent,
    estimatedCostUsd: costUsd,
    estimatedCostHkd: costHkd,
  }
}

function sumHkdCost(rows: TenantBillingRow[]): number {
  const total = rows.reduce((s, r) => s + r.estimatedCostHkd, 0)
  return Math.round(total * 100) / 100
}
