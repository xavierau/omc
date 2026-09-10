'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { StampCampaign } from '@/hooks/use-stamp-campaigns'
import type { StampCampaignAction } from '@/hooks/stamp-campaign-client'

interface StampCampaignCardViewProps {
  campaign: StampCampaign
  busy: boolean
  error: string | null
  onRun: (action: StampCampaignAction) => void
  onEnd: () => void
}

const STATUS_VARIANT: Record<StampCampaign['status'], 'default' | 'secondary'> = {
  active: 'default',
  draft: 'secondary',
  paused: 'secondary',
  ended: 'secondary',
}

// Pure presentational card (no internal state) — status drives which transition
// buttons appear. The stateful container (stamp-campaign-card) wires the handlers.
export function StampCampaignCardView({ campaign, busy, error, onRun, onEnd }: StampCampaignCardViewProps) {
  const t = useTranslations('stampCampaigns')
  return (
    <Card data-status={campaign.status}>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{campaign.name}</CardTitle>
        <Badge variant={STATUS_VARIANT[campaign.status]}>{t(`status${cap(campaign.status)}`)}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <CampaignMeta campaign={campaign} t={t} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <CampaignActions status={campaign.status} busy={busy} onRun={onRun} onEnd={onEnd} t={t} />
      </CardContent>
    </Card>
  )
}

function CampaignMeta({ campaign, t }: { campaign: StampCampaign; t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="text-sm text-muted-foreground space-y-1">
      <p>{t('stampsRequired', { count: campaign.stampsRequired })}</p>
      <p>{t('perDayCap', { count: campaign.maxStampsPerDay })}</p>
      {campaign.status === 'ended' && campaign.honorUntil && (
        <p>{t('honorUntil', { date: new Date(campaign.honorUntil).toLocaleDateString() })}</p>
      )}
    </div>
  )
}

function CampaignActions({ status, busy, onRun, onEnd, t }: {
  status: StampCampaign['status']
  busy: boolean
  onRun: (a: StampCampaignAction) => void
  onEnd: () => void
  t: ReturnType<typeof useTranslations>
}) {
  if (status === 'ended') return null
  return (
    <div className="flex flex-wrap gap-2">
      {(status === 'draft' || status === 'paused') && (
        <Button size="sm" disabled={busy} onClick={() => onRun('activate')}>{t('activate')}</Button>
      )}
      {status === 'active' && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onRun('pause')}>{t('pause')}</Button>
      )}
      <Button size="sm" variant="destructive" disabled={busy} onClick={onEnd}>{t('end')}</Button>
    </div>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
