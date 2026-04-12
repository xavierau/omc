'use client'

import { useTranslations } from 'next-intl'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { ReferrerCommissionItem } from '@/hooks/use-referrer-detail'

function CommissionRow({ item }: { item: ReferrerCommissionItem }) {
  const tc = useTranslations('common')

  return (
    <TableRow>
      <TableCell className="font-medium">{item.month}</TableCell>
      <TableCell className="text-muted-foreground">{item.tenantName}</TableCell>
      <TableCell className="text-muted-foreground">{item.messagesSent.toLocaleString()}</TableCell>
      <TableCell className="text-muted-foreground">{`HK$${item.commissionPerMessage.toFixed(2)}`}</TableCell>
      <TableCell className="font-medium">{`HK$${item.totalCommission.toFixed(2)}`}</TableCell>
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

  const columns = [
    t('month'), t('tenant'), t('messages'),
    t('commissionRate'), t('totalAmount'), t('status'),
  ]

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col}>{col}</TableHead>
            ))}
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
