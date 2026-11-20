import { getAllTenantsUsageForMonth } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import { listAllTenantsSummary } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { listReferrers } from '@/infrastructure/supabase/repositories/referrer-repository'
import { getRedemptionCountsByTenantForMonth } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import { upsertCommissions } from '@/infrastructure/supabase/repositories/referrer-commission-repository'
import { currentMonth, parseMonthRange } from '@/lib/month-range'
import { roundTwo, sumBy, toUpsertInputs } from './referrer-report-helpers'

export interface CommissionRow {
  referrerId: string
  referrerName: string
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

export interface ReferrerReport {
  month: string
  commissions: CommissionRow[]
  totalCommission: number
  totalBroadcastCommission: number
  totalRedemptionCommission: number
  tenantsProcessed: number
}

type TenantSummary = Awaited<ReturnType<typeof listAllTenantsSummary>>[number]
type ReferrerEntity = Awaited<ReturnType<typeof listReferrers>>[number]

interface BuildContext {
  tenants: TenantSummary[]
  referrerMap: Map<string, ReferrerEntity>
  usageMap: Map<string, number>
  redemptionMap: Map<string, number>
}

export async function generateReferrerReport(
  month?: string
): Promise<ReferrerReport> {
  const targetMonth = month ?? currentMonth()
  const { monthStart, monthEnd } = parseMonthRange(targetMonth)

  const [usageRows, redemptionRows, tenants, referrers] = await Promise.all([
    getAllTenantsUsageForMonth(monthStart, monthEnd),
    getRedemptionCountsByTenantForMonth(monthStart, monthEnd),
    listAllTenantsSummary(),
    listReferrers(),
  ])

  const context: BuildContext = {
    tenants,
    referrerMap: new Map(referrers.map((r) => [r.id, r])),
    usageMap: new Map(usageRows.map((r) => [r.restaurantId, r.totalSent])),
    redemptionMap: new Map(
      redemptionRows.map((r) => [r.restaurantId, r.redemptionCount])
    ),
  }

  const commissions = buildCommissions(context)
  if (commissions.length > 0) {
    await upsertCommissions(toUpsertInputs(commissions, targetMonth))
  }
  return buildReport(targetMonth, commissions)
}

function buildReport(
  month: string,
  commissions: CommissionRow[]
): ReferrerReport {
  const totalBroadcastCommission = sumBy(commissions, (c) => c.broadcastCommission)
  const totalRedemptionCommission = sumBy(commissions, (c) => c.redemptionCommission)
  return {
    month,
    commissions,
    totalCommission: roundTwo(totalBroadcastCommission + totalRedemptionCommission),
    totalBroadcastCommission,
    totalRedemptionCommission,
    tenantsProcessed: commissions.length,
  }
}

function buildCommissions(ctx: BuildContext): CommissionRow[] {
  const rows: CommissionRow[] = []
  for (const tenant of ctx.tenants) {
    const row = toCommissionRow(tenant, ctx)
    if (row) rows.push(row)
  }
  return rows
}

interface RowInput {
  tenant: TenantSummary
  referrer: ReferrerEntity
  messagesSent: number
  redemptionsCount: number
}

function toCommissionRow(
  tenant: TenantSummary,
  ctx: BuildContext
): CommissionRow | null {
  if (!tenant.referrer_id) return null
  const referrer = ctx.referrerMap.get(tenant.referrer_id)
  if (!referrer) return null

  const messagesSent = ctx.usageMap.get(tenant.id) ?? 0
  const redemptionsCount = ctx.redemptionMap.get(tenant.id) ?? 0
  if (messagesSent === 0 && redemptionsCount === 0) return null

  return composeRow({ tenant, referrer, messagesSent, redemptionsCount })
}

function composeRow(input: RowInput): CommissionRow {
  const { tenant, referrer, messagesSent, redemptionsCount } = input
  const broadcastCommission = roundTwo(messagesSent * referrer.commissionPerMessageHkd)
  const redemptionCommission = roundTwo(redemptionsCount * referrer.commissionPerRedemptionHkd)
  return {
    referrerId: referrer.id,
    referrerName: referrer.name,
    tenantId: tenant.id,
    tenantName: tenant.name,
    messagesSent,
    redemptionsCount,
    commissionPerMessage: referrer.commissionPerMessageHkd,
    commissionPerRedemption: referrer.commissionPerRedemptionHkd,
    broadcastCommission,
    redemptionCommission,
    totalCommission: roundTwo(broadcastCommission + redemptionCommission),
  }
}
