'use client'

import { useTranslations } from 'next-intl'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { AuditLogItem } from '@/hooks/use-admin-audit-logs'

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-HK', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function ActionBadge({ action }: { action: string }) {
  const t = useTranslations('auditLogs')
  const key = action.replace(/\./g, '_') as never
  const label = t.has(key) ? t(key) : action

  const variant = action.includes('delete') ? 'destructive'
    : action.includes('create') ? 'default'
    : 'secondary'

  return <Badge variant={variant}>{label}</Badge>
}

function AuditLogRow({ log }: { log: AuditLogItem }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {formatDateTime(log.createdAt)}
      </TableCell>
      <TableCell className="font-mono text-xs">{log.userId}</TableCell>
      <TableCell><ActionBadge action={log.action} /></TableCell>
      <TableCell className="text-muted-foreground">{log.resourceType}</TableCell>
      <TableCell className="font-mono text-xs">{log.resourceId}</TableCell>
      <TableCell className="text-muted-foreground text-xs">{log.ipAddress}</TableCell>
    </TableRow>
  )
}

interface AuditLogTableProps {
  logs: AuditLogItem[]
}

export function AuditLogTable({ logs }: AuditLogTableProps) {
  const t = useTranslations('auditLogs')

  const columns = [
    t('colDateTime'), t('colUser'), t('colAction'),
    t('colResourceType'), t('colResourceId'), t('colIpAddress'),
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
          {logs.map((log) => (
            <AuditLogRow key={log.id} log={log} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
