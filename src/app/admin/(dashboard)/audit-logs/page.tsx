'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useAdminAuditLogs } from '@/hooks/use-admin-audit-logs'
import { AuditLogTable } from '@/components/admin/audit-log-table'
import { Button } from '@/components/ui/button'

const REFRESH_INTERVAL = 30_000

export default function AdminAuditLogsPage() {
  const t = useTranslations('auditLogs')
  const tc = useTranslations('common')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const limit = 20

  const { logs, total, isLoading, error, mutate } = useAdminAuditLogs({ page, limit, action })
  const totalPages = Math.ceil(total / limit)

  useEffect(() => {
    const id = setInterval(mutate, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [mutate])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">{t('couldntLoad')}</p>
        <Button variant="outline" onClick={mutate} className="mt-4">{tc('retry')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
      <ActionFilter action={action} onAction={setAction} />
      {isLoading ? (
        <p className="text-muted-foreground">{tc('loading')}</p>
      ) : logs.length === 0 ? (
        <p className="text-muted-foreground">{action ? t('noMatch') : t('noLogs')}</p>
      ) : (
        <>
          <AuditLogTable logs={logs} />
          <PaginationControls page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

function ActionFilter({ action, onAction }: { action: string; onAction: (v: string) => void }) {
  const t = useTranslations('auditLogs')
  return (
    <div className="flex gap-3">
      <select
        value={action}
        onChange={e => onAction(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">{t('allActions')}</option>
        <option value="tenant.create">{t('tenant_create')}</option>
        <option value="tenant.update">{t('tenant_update')}</option>
        <option value="tenant.delete">{t('tenant_delete')}</option>
        <option value="user.create">{t('user_create')}</option>
        <option value="user.delete">{t('user_delete')}</option>
      </select>
    </div>
  )
}

function PaginationControls({ page, totalPages, total, limit, onPageChange }: {
  page: number; totalPages: number; total: number; limit: number; onPageChange: (p: number) => void
}) {
  const tc = useTranslations('common')
  const start = (page - 1) * limit + 1
  const end = Math.min(page * limit, total)
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">{tc('showing', { start, end, total })}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>{tc('previous')}</Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>{tc('next')}</Button>
      </div>
    </div>
  )
}
