'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CampaignCardView } from './campaign-card-view'
import { readExecuteError, type CampaignTemplateReviewGate } from './campaign-send-gate'

interface CampaignCardProps {
  id: string
  name: string | null
  type: string
  status: string
  sentCount: number
  redeemedCount: number
  scheduledAt?: string | null
  failureReason?: string | null
  templateReview?: CampaignTemplateReviewGate | null
  onExecute?: () => void
  onEdit?: () => void
  sendDisabled?: boolean
}

// Stateful container — owns the execute request + its error, delegating all
// rendering to the pure CampaignCardView (mirrors StampCampaignCard).
export function CampaignCard({ id, onExecute, ...rest }: CampaignCardProps) {
  const tg = useTranslations('campaignSendGate')
  const [executing, setExecuting] = useState(false)
  const [executeError, setExecuteError] = useState<string | null>(null)

  const handleExecute = async () => {
    setExecuting(true)
    setExecuteError(null)
    try {
      const res = await fetch(`/api/dashboard/campaigns/${id}/execute`, { method: 'POST' })
      if (!res.ok) {
        setExecuteError(await readExecuteError(res, tg('executeErrorFallback')))
        return
      }
      onExecute?.()
    } catch (err) {
      console.error('[CampaignCard] Execute failed:', err)
      setExecuteError(tg('executeErrorFallback'))
    } finally {
      setExecuting(false)
    }
  }

  return (
    <CampaignCardView
      {...rest}
      executing={executing}
      executeError={executeError}
      onExecute={handleExecute}
    />
  )
}
