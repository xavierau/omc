'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { ReferrerListItem } from '@/hooks/use-admin-referrers'

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-HK', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function ReferrerRow({ referrer }: { referrer: ReferrerListItem }) {
  const router = useRouter()
  const tc = useTranslations('common')

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => router.push(`/admin/referrers/${referrer.id}`)}
    >
      <TableCell className="font-medium">{referrer.name}</TableCell>
      <TableCell className="text-muted-foreground text-xs">{referrer.contactEmail}</TableCell>
      <TableCell className="text-muted-foreground">{`HK$${referrer.commissionPerMessageHkd.toFixed(2)}`}</TableCell>
      <TableCell>
        <Badge variant={referrer.status === 'active' ? 'default' : 'secondary'}>
          {referrer.status === 'active' ? tc('active') : tc('inactive')}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(referrer.createdAt)}</TableCell>
    </TableRow>
  )
}

interface ReferrerTableProps {
  referrers: ReferrerListItem[]
}

export function ReferrerTable({ referrers }: ReferrerTableProps) {
  const t = useTranslations('admin')

  const columns = [
    t('referrerName'), t('contactEmail'), t('commissionRate'),
    t('status'), t('createdAt'),
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
          {referrers.map((r) => (
            <ReferrerRow key={r.id} referrer={r} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
