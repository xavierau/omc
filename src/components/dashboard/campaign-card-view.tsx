'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { reviewGateReasonKey, type CampaignTemplateReviewGate } from './campaign-send-gate'

export interface CampaignCardViewProps {
  name: string | null
  type: string
  status: string
  sentCount: number
  redeemedCount: number
  scheduledAt?: string | null
  failureReason?: string | null
  templateReview?: CampaignTemplateReviewGate | null
  executing: boolean
  executeError: string | null
  sendDisabled?: boolean
  onExecute: () => void
  onEdit?: () => void
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'outline' {
  if (status === 'active') return 'default'
  if (status === 'completed') return 'secondary'
  return 'outline'
}

function getRedemptionColor(rate: number): string {
  if (rate > 30) return 'text-brand-success'
  if (rate > 10) return 'text-brand-accent'
  return 'text-brand-danger'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-HK', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Pure view — all state (executing/executeError) is owned by the CampaignCard
// container and threaded in as props, matching the
// stamp-campaign-card / stamp-campaign-card-view split.
export function CampaignCardView({
  name, type, status, sentCount, redeemedCount, scheduledAt,
  failureReason, templateReview, executing, executeError, sendDisabled, onExecute, onEdit,
}: CampaignCardViewProps) {
  const t = useTranslations('campaigns')
  const tg = useTranslations('campaignSendGate')
  const rate = sentCount > 0 ? (redeemedCount / sentCount) * 100 : 0
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)
  const canSendNow = status === 'active' && type !== 'welcome'
  const canEdit = ['draft', 'active', 'paused'].includes(status)
  const gateReasonKey = reviewGateReasonKey(templateReview)
  const gateReason = gateReasonKey ? tg(gateReasonKey) : null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{name || `${typeLabel} ${t('campaign')}`}</CardTitle>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Badge variant={getStatusVariant(status)}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-1">{typeLabel}</p>
        {scheduledAt && (
          <p className="text-xs text-muted-foreground mb-3">{t('scheduled', { date: formatDate(scheduledAt) })}</p>
        )}
        {status === 'failed' && (
          <p data-testid="campaign-failed-banner" className="text-xs text-destructive mb-3">
            {tg('failedTitle')}: {failureReason || tg('failedReasonFallback')}
          </p>
        )}
        <div className="flex justify-between text-sm mb-3">
          <StatCell label={t('sent')} value={sentCount} />
          <StatCell label={t('redeemed')} value={redeemedCount} />
          <div>
            <p className="text-muted-foreground">{t('rate')}</p>
            <p className={cn('text-lg font-semibold', getRedemptionColor(rate))}>{rate.toFixed(0)}%</p>
          </div>
        </div>
        {canSendNow && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={onExecute}
              disabled={executing || sendDisabled || Boolean(gateReason)}
              className="w-full"
            >
              {executing ? t('sending') : t('sendNow')}
            </Button>
            {gateReason && (
              <p data-testid="campaign-gate-reason" className="text-xs text-muted-foreground mt-1">
                {gateReason}
              </p>
            )}
            {executeError && (
              <p data-testid="campaign-execute-error" className="text-xs text-destructive mt-1">
                {executeError}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}
