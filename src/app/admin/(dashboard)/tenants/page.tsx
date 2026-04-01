'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useAdminTenants } from '@/hooks/use-admin-tenants'
import { TenantTable } from '@/components/admin/tenant-table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default function AdminTenantsPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const limit = 20

  const { tenants, total, isLoading, error, mutate } = useAdminTenants({ search, status, page, limit })
  const totalPages = Math.ceil(total / limit)

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t('tenantsHeading')}</h1>
        <Button asChild>
          <Link href="/admin/tenants/new">{t('createTenant')}</Link>
        </Button>
      </div>
      <FiltersBar search={search} onSearch={setSearch} status={status} onStatus={setStatus} />
      {isLoading ? (
        <p className="text-muted-foreground">{tc('loading')}</p>
      ) : tenants.length === 0 ? (
        <p className="text-muted-foreground">{search || status ? t('noTenantsMatch') : t('noTenants')}</p>
      ) : (
        <>
          <TenantTable tenants={tenants} />
          <PaginationControls page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

function FiltersBar({ search, onSearch, status, onStatus }: {
  search: string; onSearch: (v: string) => void; status: string; onStatus: (v: string) => void
}) {
  const t = useTranslations('admin')
  return (
    <div className="flex gap-3">
      <Input placeholder={t('searchPlaceholder')} value={search} onChange={e => onSearch(e.target.value)} className="max-w-sm" />
      <select
        value={status}
        onChange={e => onStatus(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">{t('allStatus')}</option>
        <option value="active">{t('activeOnly')}</option>
        <option value="inactive">{t('inactiveOnly')}</option>
        <option value="trial">{t('trialOnly')}</option>
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
