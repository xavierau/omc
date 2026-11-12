'use client'

// INT-001 WI-10 — US-9/§8.1/§8.3: the owner-visible activity log (member
// jobs created by this integration). Cursor-paginated over WI-8's
// `GET .../activity?cursor=` (frozen contract, `IntegrationActivityItem` --
// see artifacts/2026-09-10-int-001-wi8-backend). No mutating actions here
// (retry/resume/test all live on the outbound card / delivery log) -- this
// is a read-only log. Admin-only for the same reason as
// `delivery-log-table.tsx`: the `/activity` route itself calls
// `requireTenantAdmin` unconditionally, so `[id]/page.tsx` never fetches it
// for staff.
//
// Deviation from the plan's frozen "Tests (first)" line, disclosed per
// house rule (report stale/contradictory artifacts, never silently
// repair): the plan names "escaped metadata/external_ref rendering" as a
// WI-10 test case, but WI-8's actual `IntegrationActivityItem` projection
// (list-integration-activity.ts, frozen -- boundary: no API changes) has
// no `metadata`/`externalRef` field at all; only the underlying
// `MemberJobRow` carries them, and WI-8's application layer deliberately
// excludes them from this owner-view shape. The escaped-rendering case
// below is adapted to the fields this route actually returns
// (`welcomeOutcome`, `assertedLevel`) -- proving the same structural
// guarantee (JSX text children only, never `dangerouslySetInnerHTML`) the
// plan's case intended, against real data instead of a field that isn't on
// the wire.

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  fetchIntegrationActivity,
  type IntegrationActivityItem,
  type AssertedConsentLevel,
} from '@/hooks/integrations-client'

const WELCOME_OUTCOME_KEYS: Record<string, string> = {
  queued: 'welcomeStatusQueued',
  sent: 'welcomeStatusSent',
  failed: 'welcomeStatusFailed',
  skipped_existing: 'welcomeStatusSkippedExisting',
  skipped_by_request: 'welcomeStatusSkippedByRequest',
  skipped_off: 'welcomeStatusSkippedOff',
  skipped_opted_out: 'welcomeStatusSkippedOptedOut',
  skipped_no_template: 'welcomeStatusSkippedNoTemplate',
  skipped_consent_level: 'welcomeStatusSkippedConsentLevel',
  skipped_quality_paused: 'welcomeStatusSkippedQualityPaused',
  skipped_rate_capped: 'welcomeStatusSkippedRateCapped',
  skipped_member_missing: 'welcomeStatusSkippedMemberMissing',
}

/** Pure. Every `decideWelcome`/`processWelcomeSendJob` outcome (WI-3/WI-4,
 * `decide-welcome.ts`) maps to its own §8.1/§8.3 sentence; an outcome this
 * map doesn't name (a future addition) falls back to a generic "unknown"
 * label rather than a raw, untranslated string. */
export function welcomeOutcomeLabelKey(outcome: string | null): string {
  if (outcome === null) return 'welcomeStatusNone'
  return WELCOME_OUTCOME_KEYS[outcome] ?? 'welcomeStatusUnknown'
}

/** Pure. */
export function assertedLevelLabelKey(level: AssertedConsentLevel): string {
  switch (level) {
    case 'utility':
      return 'assertedLevelUtility'
    case 'all':
      return 'assertedLevelAll'
    default:
      return 'assertedLevelNone'
  }
}

/** Pure. `consentActions` (WI-8's wire shape) is a plain
 * `Record<string, unknown>` -- `{ utility: <action>, marketing: <action> }`
 * in practice (`process-member-create-job.ts`'s `writeConsent`), but
 * rendered generically here (any key/value pair) rather than hard-coding
 * those two category names, so an added category doesn't silently vanish. */
export function formatConsentActions(actions: Record<string, unknown> | null): Array<{ category: string; action: string }> {
  if (!actions) return []
  return Object.entries(actions).map(([category, action]) => ({ category, action: String(action) }))
}

function jobResultLabelKey(item: Pick<IntegrationActivityItem, 'status' | 'outcome'>): string {
  if (item.outcome === 'created') return 'activityOutcomeCreated'
  if (item.outcome === 'existing') return 'activityOutcomeExisting'
  if (item.status === 'processing') return 'activityJobStatusProcessing'
  if (item.status === 'failed') return 'activityJobStatusFailed'
  return 'activityJobStatusQueued'
}

export interface ActivityLogViewProps {
  rows: IntegrationActivityItem[]
  isLoading: boolean
  loadError: string | null
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}

/** Pure/props-driven. */
export function ActivityLogView({ rows, isLoading, loadError, hasMore, loadingMore, onLoadMore }: ActivityLogViewProps) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')

  return (
    <Card data-testid="activity-log-card">
      <CardHeader>
        <CardTitle>{t('activityLogTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <p className="text-sm text-muted-foreground" data-testid="activity-log-loading">
            {tc('loading')}
          </p>
        )}

        {!isLoading && loadError && (
          <p className="text-sm text-destructive" data-testid="activity-log-error">
            {t('activityLoadFailed')}
          </p>
        )}

        {!isLoading && !loadError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="activity-log-empty">
            {t('activityLogEmpty')}
          </p>
        )}

        {!isLoading && !loadError && rows.length > 0 && (
          <Table data-testid="activity-log-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('activityColSubmittedAt')}</TableHead>
                <TableHead>{t('activityColOutcome')}</TableHead>
                <TableHead>{t('activityColAssertedLevel')}</TableHead>
                <TableHead>{t('activityColConsentActions')}</TableHead>
                <TableHead>{t('activityColWelcome')}</TableHead>
                <TableHead>{t('activityColPhone')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const welcomeKey = welcomeOutcomeLabelKey(row.welcomeOutcome)
                const consentActions = formatConsentActions(row.consentActions)
                return (
                  <TableRow key={row.jobId} data-testid={`activity-row-${row.jobId}`}>
                    <TableCell>{row.submittedAt}</TableCell>
                    <TableCell data-testid={`activity-outcome-${row.jobId}`}>{t(jobResultLabelKey(row))}</TableCell>
                    <TableCell>{t(assertedLevelLabelKey(row.assertedLevel))}</TableCell>
                    <TableCell data-testid={`activity-consent-actions-${row.jobId}`}>
                      {consentActions.length === 0
                        ? '—'
                        : consentActions.map(({ category, action }) => `${category}: ${action}`).join(', ')}
                    </TableCell>
                    <TableCell data-testid={`activity-welcome-${row.jobId}`}>
                      {row.welcomeOutcome === 'skipped_consent_level' && row.welcomeDetail
                        ? t(welcomeKey, {
                            level: String(row.welcomeDetail.effective_level ?? ''),
                            required: String(row.welcomeDetail.required_level ?? ''),
                          })
                        : t(welcomeKey)}
                    </TableCell>
                    <TableCell data-testid={`activity-phone-${row.jobId}`}>•••• {row.phoneLast4}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        {hasMore && (
          <Button variant="outline" onClick={onLoadMore} disabled={loadingMore} data-testid="activity-load-more">
            {loadingMore ? tc('loading') : t('activityLoadMore')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function ActivityLogTable({ integrationId }: { integrationId: string }) {
  const [rows, setRows] = useState<IntegrationActivityItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadFirstPage = useCallback(() => {
    return fetchIntegrationActivity(integrationId).then((result) => {
      if (result.ok) {
        setRows(result.data)
        setNextCursor(result.nextCursor)
        setLoadError(null)
      } else {
        setLoadError(result.error)
      }
      setIsLoading(false)
    })
  }, [integrationId])

  useEffect(() => {
    loadFirstPage()
  }, [loadFirstPage])

  const onLoadMore = () => {
    if (!nextCursor) return
    setLoadingMore(true)
    fetchIntegrationActivity(integrationId, { cursor: nextCursor }).then((result) => {
      if (result.ok) {
        setRows((prev) => [...prev, ...result.data])
        setNextCursor(result.nextCursor)
      }
      setLoadingMore(false)
    })
  }

  return (
    <ActivityLogView
      rows={rows}
      isLoading={isLoading}
      loadError={loadError}
      hasMore={nextCursor !== null}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
    />
  )
}
