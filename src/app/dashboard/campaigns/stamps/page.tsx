'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useStampCampaigns, type StampCampaign } from '@/hooks/use-stamp-campaigns'
import { useRewards } from '@/hooks/use-rewards'
import { StampCampaignCard } from '@/components/dashboard/stamp-campaign-card'
import { StampCampaignFormDialog } from '@/components/dashboard/stamp-campaign-form-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

export default function StampCampaignsPage() {
  const t = useTranslations('stampCampaigns')
  const { campaigns, isLoading, error, refetch } = useStampCampaigns()
  const { data: rewards } = useRewards()
  const [formOpen, setFormOpen] = useState(false)

  if (error) return <ErrorFallback onRetry={refetch} />
  if (isLoading) return <LoadingSkeleton />

  const active = campaigns.filter((c) => c.status === 'active')
  const other = campaigns.filter((c) => c.status !== 'active')

  return (
    <div className="space-y-6">
      <PageHeader onCreate={() => setFormOpen(true)} />
      {campaigns.length === 0 ? (
        <EmptyState title={t('noStampCardsTitle')} description={t('noStampCardsDescription')} />
      ) : (
        <>
          {active.length > 0 && <Section title={t('activeSectionTitle')} campaigns={active} onChanged={refetch} />}
          {other.length > 0 && <Section title={t('otherSectionTitle')} campaigns={other} onChanged={refetch} />}
        </>
      )}
      <StampCampaignFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSuccess={refetch}
        rewards={rewards ?? []}
      />
    </div>
  )
}

function PageHeader({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('stampCampaigns')
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>
      <Button onClick={onCreate}>{t('create')}</Button>
    </div>
  )
}

function Section({ title, campaigns, onChanged }: {
  title: string
  campaigns: StampCampaign[]
  onChanged: () => void
}) {
  return (
    <div>
      <h2 className="text-lg font-medium text-foreground mb-3">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {campaigns.map((c) => (
          <StampCampaignCard key={c.id} campaign={c} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('stampCampaigns')
  const tc = useTranslations('common')
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <p className="text-muted-foreground">{t('couldntLoad')}</p>
      <Button variant="outline" onClick={onRetry} className="mt-4">{tc('retry')}</Button>
    </div>
  )
}

function LoadingSkeleton() {
  const t = useTranslations('stampCampaigns')
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
