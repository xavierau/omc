'use client'

import { useState } from 'react'
import { useWaTemplates, syncTemplates } from '@/hooks/use-wa-templates'
import type { WaTemplate } from '@/hooks/use-wa-templates'
import { WaTemplateTable } from '@/components/dashboard/wa-template-table'
import { WaTemplateFilters } from '@/components/dashboard/wa-template-filters'
import { WaTemplateFormDialog } from '@/components/dashboard/wa-template-form-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

export default function WaTemplatesPage() {
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
  const handleEdit = (t: WaTemplate) => { setEditingTemplate(t); setFormOpen(true) }
  const handleFormClose = (open: boolean) => { if (!open) setEditingTemplate(null); setFormOpen(open) }

  if (error) return <ErrorFallback />
  if (isLoading) return <LoadingSkeleton />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">WhatsApp Templates</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync Status'}
          </Button>
          <Button onClick={handleCreate}>Create Template</Button>
        </div>
      </div>
      <WaTemplateFilters status={status} category={category} onStatusChange={setStatus} onCategoryChange={setCategory} />
      {templates.length === 0
        ? <EmptyState title="No templates" description="Create your first WhatsApp template or sync from Meta." />
        : <WaTemplateTable templates={templates} onEdit={handleEdit} />
      }
      <WaTemplateFormDialog open={formOpen} onOpenChange={handleFormClose} onSuccess={refetch} template={editingTemplate} />
    </div>
  )
}

function ErrorFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <p className="text-muted-foreground">Couldn&apos;t load templates.</p>
      <Button variant="outline" onClick={() => window.location.reload()} className="mt-4">Retry</Button>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">WhatsApp Templates</h1>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/50 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  )
}
