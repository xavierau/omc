'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { TenantListItem } from '@/hooks/use-admin-tenants'

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-HK', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function TenantRow({ tenant }: { tenant: TenantListItem }) {
  const router = useRouter()
  const tc = useTranslations('common')

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => router.push(`/admin/tenants/${tenant.id}`)}
    >
      <TableCell className="font-medium">{tenant.name}</TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">{tenant.slug}</TableCell>
      <TableCell className="text-muted-foreground text-xs">{tenant.phoneNumberId ?? '\u2014'}</TableCell>
      <TableCell>{tenant.memberCount}</TableCell>
      <TableCell>
        <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'}>
          {tenant.status === 'active' ? tc('active') : tc('inactive')}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(tenant.createdAt)}</TableCell>
    </TableRow>
  )
}

interface TenantTableProps {
  tenants: TenantListItem[]
}

export function TenantTable({ tenants }: TenantTableProps) {
  const t = useTranslations('admin')

  const columns = [
    t('name'), t('slug'), t('phoneNumberId'),
    t('members'), t('status'), t('createdAt'),
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
          {tenants.map((tenant) => (
            <TenantRow key={tenant.id} tenant={tenant} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
