'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { StampCampaignCardView } from './stamp-campaign-card-view'
import { EndCampaignDialog } from './end-campaign-dialog'
import { mapTransitionError } from './stamp-campaign-error-map'
import { transitionStampCampaign, type StampCampaignAction } from '@/hooks/stamp-campaign-client'
import type { StampCampaign } from '@/hooks/use-stamp-campaigns'

interface StampCampaignCardProps {
  campaign: StampCampaign
  onChanged: () => void
}

// Stateful container — owns the transition request + end-confirm dialog, delegating
// all rendering to the pure StampCampaignCardView.
export function StampCampaignCard({ campaign, onChanged }: StampCampaignCardProps) {
  const t = useTranslations('stampCampaigns')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [endOpen, setEndOpen] = useState(false)

  async function run(action: StampCampaignAction) {
    setBusy(true); setError(null)
    const out = await transitionStampCampaign(campaign.id, action)
    setBusy(false)
    if (!out.ok) { setError(t(mapTransitionError(out.error))); return }
    onChanged()
  }

  return (
    <>
      <StampCampaignCardView
        campaign={campaign}
        busy={busy}
        error={error}
        onRun={run}
        onEnd={() => setEndOpen(true)}
      />
      <EndCampaignDialog
        open={endOpen}
        busy={busy}
        onOpenChange={setEndOpen}
        onConfirm={async () => { await run('end'); setEndOpen(false) }}
      />
    </>
  )
}
