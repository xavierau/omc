import { useTranslations } from 'next-intl'
import {
  Table, TableBody, TableCell, TableFooter,
  TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

function formatHKD(amount: number): string {
  return `HK$${amount.toFixed(2)}`
}

interface CommissionTableRow {
  referrerName: string
  tenantName: string
  messagesSent: number
  commissionPerMessage: number
  broadcastCommission: number
  redemptionsCount: number
  commissionPerRedemption: number
  redemptionCommission: number
  totalCommission: number
}

interface TableTotals {
  totalCommission: number
  totalBroadcastCommission: number
  totalRedemptionCommission: number
}

export function CommissionTable({ t, commissions, totals }: {
  t: ReturnType<typeof useTranslations<'admin'>>
  commissions: CommissionTableRow[]
  totals: TableTotals
}) {
  if (commissions.length === 0) {
    return <p className="text-muted-foreground">{t('noCommissionData')}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('referrer')}</TableHead>
          <TableHead>{t('tenant')}</TableHead>
          <TableHead className="text-right">{t('messages')}</TableHead>
          <TableHead className="text-right">{t('broadcastCommission')}</TableHead>
          <TableHead className="text-right">{t('redemptions')}</TableHead>
          <TableHead className="text-right">{t('redemptionCommission')}</TableHead>
          <TableHead className="text-right">{t('totalCommission')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {commissions.map((row) => (
          <TableRow key={`${row.referrerName}-${row.tenantName}`}>
            <TableCell>{row.referrerName}</TableCell>
            <TableCell>{row.tenantName}</TableCell>
            <TableCell className="text-right">{row.messagesSent.toLocaleString()}</TableCell>
            <TableCell className="text-right">{formatHKD(row.broadcastCommission)}</TableCell>
            <TableCell className="text-right">{row.redemptionsCount.toLocaleString()}</TableCell>
            <TableCell className="text-right">{formatHKD(row.redemptionCommission)}</TableCell>
            <TableCell className="text-right font-medium">{formatHKD(row.totalCommission)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3} className="font-medium">Total</TableCell>
          <TableCell className="text-right font-medium">{formatHKD(totals.totalBroadcastCommission)}</TableCell>
          <TableCell />
          <TableCell className="text-right font-medium">{formatHKD(totals.totalRedemptionCommission)}</TableCell>
          <TableCell className="text-right font-medium">{formatHKD(totals.totalCommission)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
