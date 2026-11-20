import type { CommissionRow } from '@/application/generate-referrer-report'

const BOM = '\ufeff'
const HEADER = [
  'Referrer',
  'Tenant',
  'Messages Sent',
  'Rate (HK$/msg)',
  'Broadcast Commission (HK$)',
  'Redemptions',
  'Rate (HK$/redemption)',
  'Redemption Commission (HK$)',
  'Total Commission (HK$)',
].join(',')

function escapeCsvField(value: string): string {
  if (/[,"\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function formatRow(row: CommissionRow): string {
  return [
    escapeCsvField(row.referrerName),
    escapeCsvField(row.tenantName),
    row.messagesSent,
    row.commissionPerMessage.toFixed(2),
    row.broadcastCommission.toFixed(2),
    row.redemptionsCount,
    row.commissionPerRedemption.toFixed(2),
    row.redemptionCommission.toFixed(2),
    row.totalCommission.toFixed(2),
  ].join(',')
}

export function generateCommissionCsv(rows: CommissionRow[]): string {
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
