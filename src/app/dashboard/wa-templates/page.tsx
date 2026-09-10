'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useWaTemplates, syncTemplates } from '@/hooks/use-wa-templates'
import type { WaTemplate } from '@/hooks/use-wa-templates'
import { WaTemplateTable } from '@/components/dashboard/wa-template-table'
import { WaTemplateFilters } from '@/components/dashboard/wa-template-filters'
import { WaTemplateFormDialog } from '@/components/dashboard/wa-template-form-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

export default function WaTemplatesPage() {
  const t = useTranslations('waTemplates')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<WaTemplate | null>(null)

  const filters = {
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
  }
  const { templates, isLoading, error, refetch } = useWaTemplates(filters)

  const handleSync = async () => {
    setSyncing(true)
    try { await syncTemplates(); refetch() } catch { /* noop */ }
    finally { setSyncing(false) }
  }

  const handleCreate = () => { setEditingTemplate(null); setFormOpen(true) }
  const handleEdit = (tmpl: WaTemplate) => { setEditingTemplate(tmpl); setFormOpen(true) }
  const handleFormClose = (open: boolean) => { if (!open) setEditingTemplate(null); setFormOpen(open) }

  if (error) return <ErrorFallback onRetry={refetch} />
  if (isLoading) return <LoadingSkeleton />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            {syncing ? t('syncing') : t('syncStatus')}
          </Button>
          <Button onClick={handleCreate}>{t('createTemplate')}</Button>
        </div>
      </div>
      <WaTemplateFilters status={status} category={category} onStatusChange={setStatus} onCategoryChange={setCategory} />
      {templates.length === 0
        ? <EmptyState title={t('noTemplatesTitle')} description={t('noTemplatesDescription')} />
        : <WaTemplateTable templates={templates} onEdit={handleEdit} />
      }
      <WaTemplateFormDialog open={formOpen} onOpenChange={handleFormClose} onSuccess={refetch} template={editingTemplate} />
    </div>
  )
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('waTemplates')
  const tc = useTranslations('common')

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <p className="text-muted-foreground">{t('couldntLoad')}</p>
      <Button variant="outline" onClick={onRetry} className="mt-4">{tc('retry')}</Button>
    </div>
  )
}

function LoadingSkeleton() {
  const t = useTranslations('waTemplates')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/50 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  )
}
