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
  totalCommission: number
}

export function CommissionTable({ t, commissions, totalCommission }: {
  t: ReturnType<typeof useTranslations<'admin'>>
  commissions: CommissionTableRow[]
  totalCommission: number
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
          <TableHead className="text-right">{t('rate')}</TableHead>
          <TableHead className="text-right">{t('commission')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {commissions.map((row) => (
          <TableRow key={`${row.referrerName}-${row.tenantName}`}>
            <TableCell>{row.referrerName}</TableCell>
            <TableCell>{row.tenantName}</TableCell>
            <TableCell className="text-right">{row.messagesSent.toLocaleString()}</TableCell>
            <TableCell className="text-right">{formatHKD(row.commissionPerMessage)}</TableCell>
            <TableCell className="text-right">{formatHKD(row.totalCommission)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4} className="font-medium">Total</TableCell>
          <TableCell className="text-right font-medium">{formatHKD(totalCommission)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
