'use client'

// INT-001 WI-10 — US-9/§8.2: the auto-pause banner + "Resume deliveries"
// (WI-6's breaker trips outbound to `paused_auto` after 10 consecutive
// failures; WI-8's `POST .../outbound/resume` resets the streak and
// requeues, 200 `{ requeued }` | 422 `url_invalid`). Deliberately does NOT
// render for `paused_manual` -- spec's own copy scopes this banner to the
// auto-pause case only ("When auto-paused, a banner shows the failure
// streak and a Resume deliveries button"); a manual pause has no streak to
// show and no shipped UI to set/clear it in this feature, so there is
// nothing this banner could meaningfully add for that state.
//
// Rendered at the top of the detail page (`[id]/page.tsx`), above the
// Tabs, per the dispatch -- visible regardless of which tab is active.
// Admin-only: `outboundStatus`/`failureStreak` only exist on
// `IntegrationSettingsView`, which the page never fetches for staff (same
// gate as every other admin-only card here).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { resumeOutboundRequest, type OutboundStatus } from '@/hooks/integrations-client'
import { resumeOutboundErrorMessageKey } from '@/components/dashboard/integrations/settings-error-messages'

/** Pure. */
export function shouldShowPausedBanner(outboundStatus: OutboundStatus): boolean {
  return outboundStatus === 'paused_auto'
}

export type ResumeState = 'idle' | 'resuming' | 'resumed' | 'error'

export interface PausedBannerViewProps {
  failureStreak: number
  resumeState: ResumeState
  requeuedCount: number | null
  errorCode: string | null
  onResume: () => void
}

/** Pure/props-driven. `resumeState === 'resumed'` replaces the
 * streak+Resume UI with a success confirmation (spec §8.2 success copy:
 * "Banner clears; queued events start flowing") -- the CONTAINER also
 * calls `onResumed()` so the page refetches settings and the banner
 * unmounts entirely once `outboundStatus` is no longer `paused_auto`. */
export function PausedBannerView({ failureStreak, resumeState, requeuedCount, errorCode, onResume }: PausedBannerViewProps) {
  const t = useTranslations('integrations')

  if (resumeState === 'resumed') {
    return (
      <div
        className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"
        data-testid="paused-banner-resumed"
      >
        {t('pausedBannerResumeSuccess', { count: requeuedCount ?? 0 })}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="paused-banner">
      <p className="text-sm font-medium text-amber-800">{t('pausedBannerTitle')}</p>
      <p className="text-xs text-amber-800" data-testid="paused-banner-streak">
        {t('pausedBannerStreak', { count: failureStreak })}
      </p>
      <Button
        size="sm"
        className="mt-2"
        disabled={resumeState === 'resuming'}
        onClick={onResume}
        data-testid="paused-banner-resume"
      >
        {resumeState === 'resuming' ? t('pausedBannerResuming') : t('pausedBannerResume')}
      </Button>
      {resumeState === 'error' && errorCode && (
        <p className="text-xs text-destructive mt-2" data-testid="paused-banner-error">
          {t(resumeOutboundErrorMessageKey(errorCode))}
        </p>
      )}
    </div>
  )
}

export function PausedBannerCard({
  integrationId,
  outboundStatus,
  failureStreak,
  onResumed,
}: {
  integrationId: string
  outboundStatus: OutboundStatus
  failureStreak: number
  onResumed: () => void
}) {
  const [resumeState, setResumeState] = useState<ResumeState>('idle')
  const [requeuedCount, setRequeuedCount] = useState<number | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  if (!shouldShowPausedBanner(outboundStatus) && resumeState !== 'resumed') {
    return null
  }

  const onResume = async () => {
    setResumeState('resuming')
    setErrorCode(null)
    const result = await resumeOutboundRequest(integrationId)
    if (!result.ok) {
      setErrorCode(result.error)
      setResumeState('error')
      return
    }
    setRequeuedCount(result.requeued)
    setResumeState('resumed')
    onResumed()
  }

  return (
    <PausedBannerView
      failureStreak={failureStreak}
      resumeState={resumeState}
      requeuedCount={requeuedCount}
      errorCode={errorCode}
      onResume={onResume}
    />
  )
}
