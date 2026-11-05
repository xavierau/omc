import type { TenantBillingRow } from '@/application/get-billing-report'

const BOM = '\ufeff'
const HEADER = [
  'Tenant',
  'Plan',
  'Campaigns',
  'Messages Sent',
  'Cost (USD)',
  'Cost (HKD)',
  'Meta Cost (HKD)',
  'Broadcast Fee (HKD)',
  'Redemptions',
  'Redemption Fee (HKD)',
  'Total Charge (HKD)',
].join(',')

function escapeCsvField(value: string): string {
  if (/[,"\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function formatRow(row: TenantBillingRow): string {
  return [
    escapeCsvField(row.tenantName),
    row.plan,
    row.campaignsRun,
    row.messagesSent,
    row.estimatedCostUsd.toFixed(2),
    row.estimatedCostHkd.toFixed(2),
    row.metaCostHkd.toFixed(2),
    row.broadcastFeeHkd.toFixed(2),
    row.redemptionsCount,
    row.redemptionFeeHkd.toFixed(2),
    row.totalChargeHkd.toFixed(2),
  ].join(',')
}

export function generateBillingCsv(rows: TenantBillingRow[]): string {
  if (rows.length === 0) return BOM + HEADER
  return BOM + [HEADER, ...rows.map(formatRow)].join('\n')
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
