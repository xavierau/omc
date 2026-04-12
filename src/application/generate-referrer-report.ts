import { getAllTenantsUsageForMonth } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import { listAllTenantsSummary } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { listActiveReferrers } from '@/infrastructure/supabase/repositories/referrer-repository'
import { upsertCommissions } from '@/infrastructure/supabase/repositories/referrer-commission-repository'
import type { UpsertCommissionInput } from '@/infrastructure/supabase/repositories/referrer-commission-mapper'
import { currentMonth, parseMonthRange } from '@/lib/month-range'

export interface CommissionRow {
  referrerId: string
  referrerName: string
  tenantId: string
  tenantName: string
  messagesSent: number
  commissionPerMessage: number
  totalCommission: number
}

export interface ReferrerReport {
  month: string
  commissions: CommissionRow[]
  totalCommission: number
  tenantsProcessed: number
}

export async function generateReferrerReport(
  month?: string
): Promise<ReferrerReport> {
  const targetMonth = month ?? currentMonth()
  const { monthStart, monthEnd } = parseMonthRange(targetMonth)

  const [usageRows, tenants, referrers] = await Promise.all([
    getAllTenantsUsageForMonth(monthStart, monthEnd),
    listAllTenantsSummary(),
    listActiveReferrers(),
  ])

  const usageMap = new Map(usageRows.map((r) => [r.restaurantId, r]))
  const referrerMap = new Map(referrers.map((r) => [r.id, r]))

  const commissions = buildCommissions(tenants, referrerMap, usageMap)

  if (commissions.length > 0) {
    await upsertCommissions(toUpsertInputs(commissions, targetMonth))
  }

  const totalCommission = roundTwo(
    commissions.reduce((s, c) => s + c.totalCommission, 0)
  )

  return { month: targetMonth, commissions, totalCommission, tenantsProcessed: commissions.length }
}

function buildCommissions(
  tenants: Awaited<ReturnType<typeof listAllTenantsSummary>>,
  referrerMap: Map<string, Awaited<ReturnType<typeof listActiveReferrers>>[number]>,
  usageMap: Map<string, { totalSent: number }>
): CommissionRow[] {
  const rows: CommissionRow[] = []
  for (const tenant of tenants) {
    const row = toCommissionRow(tenant, referrerMap, usageMap)
    if (row) rows.push(row)
  }
  return rows
}

function toCommissionRow(
  tenant: { id: string; name: string; referrer_id: string | null },
  referrerMap: Map<string, { id: string; name: string; commissionPerMessageHkd: number }>,
  usageMap: Map<string, { totalSent: number }>
): CommissionRow | null {
  if (!tenant.referrer_id) return null
  const referrer = referrerMap.get(tenant.referrer_id)
  if (!referrer) return null
  const usage = usageMap.get(tenant.id)
  if (!usage || usage.totalSent === 0) return null

  const rate = referrer.commissionPerMessageHkd
  return {
    referrerId: referrer.id,
    referrerName: referrer.name,
    tenantId: tenant.id,
    tenantName: tenant.name,
    messagesSent: usage.totalSent,
    commissionPerMessage: rate,
    totalCommission: roundTwo(usage.totalSent * rate),
  }
}

function toUpsertInputs(
  commissions: CommissionRow[],
  month: string
): UpsertCommissionInput[] {
  return commissions.map((c) => ({
    referrerId: c.referrerId,
    month,
    tenantId: c.tenantId,
    tenantName: c.tenantName,
    messagesSent: c.messagesSent,
    commissionPerMessage: c.commissionPerMessage,
    totalCommission: c.totalCommission,
  }))
}

function roundTwo(n: number): number {
  return Math.round(n * 100) / 100
}
