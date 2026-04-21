'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useCampaigns } from '@/hooks/use-campaigns'
import type { Campaign } from '@/hooks/use-campaigns'
import { useCampaignGuardrails } from '@/hooks/use-campaign-guardrails'
import { CampaignCard } from '@/components/dashboard/campaign-card'
import { CampaignGuardrailBanner } from '@/components/dashboard/campaign-guardrail-banner'
import { CampaignFormDialog } from '@/components/dashboard/campaign-form-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

export default function CampaignsPage() {
  const t = useTranslations('campaigns')
  const { campaigns, isLoading, error, refetch } = useCampaigns()
  const guardrails = useCampaignGuardrails()
  const [formOpen, setFormOpen] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)

  const handleEdit = (campaign: Campaign) => { setEditingCampaign(campaign); setFormOpen(true) }
  const handleFormClose = (open: boolean) => { setFormOpen(open); if (!open) setEditingCampaign(null) }
  const sendDisabled = guardrails.data ? !guardrails.data.allowed : false

  if (error) return <ErrorFallback onRetry={refetch} />
  if (isLoading) return <LoadingSkeleton />
  if (campaigns.length === 0) return <EmptyCampaigns onCreate={() => setFormOpen(true)} formOpen={formOpen} setFormOpen={setFormOpen} refetch={refetch} />

  const active = campaigns.filter((c) => c.status === 'active')
  const other = campaigns.filter((c) => c.status !== 'active')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <Button onClick={() => setFormOpen(true)}>{t('createCampaign')}</Button>
      </div>
      {guardrails.data && <CampaignGuardrailBanner guardrails={guardrails.data} />}
      {active.length > 0 && <CampaignSection title={t('activeSectionTitle')} campaigns={active} onExecute={refetch} onEdit={handleEdit} sendDisabled={sendDisabled} />}
      {other.length > 0 && <CampaignSection title={t('scheduledSectionTitle')} campaigns={other} onExecute={refetch} onEdit={handleEdit} sendDisabled={sendDisabled} />}
      <CampaignFormDialog open={formOpen} onOpenChange={handleFormClose} onSuccess={refetch} campaign={editingCampaign} />
    </div>
  )
}

function CampaignSection({ title, campaigns, onExecute, onEdit, sendDisabled }: {
  title: string; campaigns: Campaign[]; onExecute: () => void; onEdit: (c: Campaign) => void; sendDisabled: boolean
}) {
  return (
    <div>
      <h2 className="text-lg font-medium text-foreground mb-3">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {campaigns.map((c) => (
          <CampaignCard
            key={c.id}
            id={c.id}
            name={c.name}
            type={c.type}
            status={c.status}
            sentCount={c.chargeableSentCount + c.nonChargeableSentCount}
            redeemedCount={c.redeemedCount}
            scheduledAt={c.scheduledAt}
            onExecute={onExecute}
            onEdit={() => onEdit(c)}
            sendDisabled={sendDisabled}
          />
        ))}
      </div>
    </div>
  )
}

function EmptyCampaigns({ onCreate, formOpen, setFormOpen, refetch }: {
  onCreate: () => void; formOpen: boolean; setFormOpen: (o: boolean) => void; refetch: () => void
}) {
  const t = useTranslations('campaigns')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <Button onClick={onCreate}>{t('createCampaign')}</Button>
      </div>
      <EmptyState title={t('noCampaignsTitle')} description={t('noCampaignsDescription')} />
      <CampaignFormDialog open={formOpen} onOpenChange={setFormOpen} onSuccess={refetch} />
    </div>
  )
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('campaigns')
  const tc = useTranslations('common')

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <p className="text-muted-foreground">{t('couldntLoad')}</p>
      <Button variant="outline" onClick={onRetry} className="mt-4">{tc('retry')}</Button>
    </div>
  )
}

function LoadingSkeleton() {
  const t = useTranslations('campaigns')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-40 bg-muted/50 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  )
}
