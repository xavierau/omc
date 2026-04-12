'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAdminReferrers } from '@/hooks/use-admin-referrers'
import { ReferrerTable } from '@/components/admin/referrer-table'
import { ReferrerFormDialog } from '@/components/admin/referrer-form-dialog'
import { Button } from '@/components/ui/button'

export default function AdminReferrersPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [status, setStatus] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  const { referrers, isLoading, error, mutate } = useAdminReferrers({ status })

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
        <h1 className="text-2xl font-semibold text-foreground">{t('referrersHeading')}</h1>
        <Button onClick={() => setFormOpen(true)}>{t('addReferrer')}</Button>
      </div>
      <StatusFilter status={status} onStatus={setStatus} />
      {isLoading ? (
        <p className="text-muted-foreground">{tc('loading')}</p>
      ) : referrers.length === 0 ? (
        <p className="text-muted-foreground">{status ? t('noReferrersMatch') : t('noReferrers')}</p>
      ) : (
        <ReferrerTable referrers={referrers} />
      )}
      <ReferrerFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSaved={mutate} />
    </div>
  )
}

function StatusFilter({ status, onStatus }: { status: string; onStatus: (v: string) => void }) {
  const t = useTranslations('admin')
  return (
    <div className="flex gap-3">
      <select
        value={status}
        onChange={(e) => onStatus(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">{t('allStatus')}</option>
        <option value="active">{t('activeOnly')}</option>
        <option value="inactive">{t('inactiveOnly')}</option>
      </select>
    </div>
  )
}
