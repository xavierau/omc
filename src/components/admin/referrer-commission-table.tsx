'use client'

import { useTranslations } from 'next-intl'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { ReferrerCommissionItem } from '@/hooks/use-referrer-detail'

function formatHKD(amount: number): string {
  return `HK$${amount.toFixed(2)}`
}

function CommissionRow({ item }: { item: ReferrerCommissionItem }) {
  const tc = useTranslations('common')

  return (
    <TableRow>
      <TableCell className="font-medium">{item.month}</TableCell>
      <TableCell className="text-muted-foreground">{item.tenantName}</TableCell>
      <TableCell className="text-right text-muted-foreground">{item.messagesSent.toLocaleString()}</TableCell>
      <TableCell className="text-right text-muted-foreground">{formatHKD(item.broadcastCommission)}</TableCell>
      <TableCell className="text-right text-muted-foreground">{item.redemptionsCount.toLocaleString()}</TableCell>
      <TableCell className="text-right text-muted-foreground">{formatHKD(item.redemptionCommission)}</TableCell>
      <TableCell className="text-right font-medium">{formatHKD(item.totalCommission)}</TableCell>
      <TableCell>
        <Badge variant={item.status === 'paid' ? 'default' : 'secondary'}>
          {item.status === 'paid' ? tc('paid') : tc('pending')}
        </Badge>
      </TableCell>
    </TableRow>
  )
}

interface ReferrerCommissionTableProps {
  commissions: ReferrerCommissionItem[]
}

export function ReferrerCommissionTable({ commissions }: ReferrerCommissionTableProps) {
  const t = useTranslations('admin')

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('month')}</TableHead>
            <TableHead>{t('tenant')}</TableHead>
            <TableHead className="text-right">{t('messages')}</TableHead>
            <TableHead className="text-right">{t('broadcastCommission')}</TableHead>
            <TableHead className="text-right">{t('redemptions')}</TableHead>
            <TableHead className="text-right">{t('redemptionCommission')}</TableHead>
            <TableHead className="text-right">{t('totalCommission')}</TableHead>
            <TableHead>{t('status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {commissions.map((item) => (
            <CommissionRow key={item.id} item={item} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
