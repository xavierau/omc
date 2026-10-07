'use client'

// INT-001 WI-10 — US-9: the outbound delivery log (spec §8.2's "Retry
// dead-lettered" row + the plan's WI-10 file list). Cursor-paginated over
// WI-8's `GET .../deliveries?status=&cursor=` (frozen contract — see
// artifacts/2026-09-10-int-001-wi8-backend); "Retry" re-enqueues a single
// dead-lettered row via WI-8's `POST .../deliveries/[deliveryId]/retry`
// (202 `already_retried` -> 409). Admin-only, matching WI-9's own
// settings-gate precedent: the GET route itself calls `requireTenantAdmin`
// unconditionally (no staff branch at all, unlike the base integration
// GET), so the page never even calls it for staff (see
// `[id]/page.tsx`) rather than fetch-then-403.
//
// This is also where WI-9's outbound-test extension point
// (`outbound-test-extension-point` in `outbound-webhook-card.tsx`) lands:
// "Send test event"'s success state links here via `onViewDelivery` ->
// `highlightDeliveryId`, which rings the matching row once it appears on
// this table's first page.
//
// Split into a stateful container + a pure `DeliveryLogView`, same
// reasoning as every other WI-9/WI-10 card in this directory (no
// jsdom/RTL in this repo -- only the pure view is render-tree-tested).

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  fetchIntegrationDeliveries,
  retryDeliveryRequest,
  type IntegrationDeliveryListItem,
  type IntegrationDeliveryStatus,
} from '@/hooks/integrations-client'
import { retryDeliveryErrorMessageKey } from '@/components/dashboard/integrations/settings-error-messages'

const ALL_STATUSES: IntegrationDeliveryStatus[] = [
  'queued',
  'delivering',
  'retrying',
  'delivered',
  'dead_lettered',
  'paused',
  'skipped',
]

/** Pure. */
export function deliveryStatusLabelKey(status: IntegrationDeliveryStatus): string {
  switch (status) {
    case 'queued':
      return 'deliveryStatusQueued'
    case 'delivering':
      return 'deliveryStatusDelivering'
    case 'retrying':
      return 'deliveryStatusRetrying'
    case 'delivered':
      return 'deliveryStatusDelivered'
    case 'dead_lettered':
      return 'deliveryStatusDeadLettered'
    case 'paused':
      return 'deliveryStatusPaused'
    case 'skipped':
      return 'deliveryStatusSkipped'
  }
}

/** Pure. Retry (US-9) is only offered on a dead-lettered row that hasn't
 * already had a retry issued this session -- `retry-delivery.ts`'s own
 * one-retry-per-event guard (`retried_at IS NULL`) is mirrored client-side
 * so the button disables immediately rather than waiting on a 409. */
export function canRetryRow(status: IntegrationDeliveryStatus, alreadyRetried: boolean): boolean {
  return status === 'dead_lettered' && !alreadyRetried
}

/** Pure. Spec US-9: "the owner is expected to swap in the partner's system
 * and ours back-to-back and use Retry on any dead-lettered rows" -- this is
 * the notice that points them at that action. Fires only when the secret
 * was updated AFTER every currently dead-lettered delivery on the loaded
 * page (`createdAt` is the closest proxy this route's projection exposes;
 * `IntegrationDeliveryListItem` has no `deadLetteredAt` -- see this file's
 * header/handoff for the disclosed gap against the domain entity's own
 * field). Not gated on WHY they dead-lettered (a real, unrelated failure
 * dead-lettered before the swap also counts) -- the plan's own condition
 * is this literal timestamp comparison, not a root-cause classification. */
export function deadLetteredSinceSecretChangeCount(
  deadLetteredCreatedAts: string[],
  outboundSecretUpdatedAt: string | null
): number {
  if (!outboundSecretUpdatedAt || deadLetteredCreatedAts.length === 0) return 0
  const secretTime = new Date(outboundSecretUpdatedAt).getTime()
  const mostRecentDeadLetter = Math.max(...deadLetteredCreatedAts.map((t) => new Date(t).getTime()))
  if (secretTime <= mostRecentDeadLetter) return 0
  return deadLetteredCreatedAts.length
}

export interface DeliveryLogViewProps {
  rows: IntegrationDeliveryListItem[]
  statusFilter: IntegrationDeliveryStatus | 'all'
  onStatusFilterChange: (value: IntegrationDeliveryStatus | 'all') => void
  isLoading: boolean
  loadError: string | null
  retryingId: string | null
  retriedIds: ReadonlySet<string>
  retryErrorByRow: Readonly<Record<string, string>>
  onRetry: (deliveryId: string) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  deadLetteredNoticeCount: number
  highlightDeliveryId?: string | null
}

/** Pure/props-driven. */
export function DeliveryLogView({
  rows,
  statusFilter,
  onStatusFilterChange,
  isLoading,
  loadError,
  retryingId,
  retriedIds,
  retryErrorByRow,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
  deadLetteredNoticeCount,
  highlightDeliveryId,
}: DeliveryLogViewProps) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')

  return (
    <Card data-testid="delivery-log-card">
      <CardHeader>
        <CardTitle>{t('deliveryLogTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {deadLetteredNoticeCount > 0 && (
          <p
            className="text-xs rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-800"
            data-testid="delivery-secret-change-notice"
          >
            {t('deadLetteredSinceSecretChange', { count: deadLetteredNoticeCount })}
          </p>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor="delivery-status-filter" className="text-sm font-medium text-foreground">
            {t('deliveryStatusFilterLabel')}
          </label>
          <select
            id="delivery-status-filter"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as IntegrationDeliveryStatus | 'all')}
            data-testid="delivery-status-filter"
          >
            <option value="all">{t('deliveryStatusAll')}</option>
            {ALL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(deliveryStatusLabelKey(status))}
              </option>
            ))}
          </select>
        </div>

        {isLoading && (
          <p className="text-sm text-muted-foreground" data-testid="delivery-log-loading">
            {tc('loading')}
          </p>
        )}

        {!isLoading && loadError && (
          <p className="text-sm text-destructive" data-testid="delivery-log-error">
            {t('deliveryLoadFailed')}
          </p>
        )}

        {!isLoading && !loadError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="delivery-log-empty">
            {t('deliveryLogEmpty')}
          </p>
        )}

        {!isLoading && !loadError && rows.length > 0 && (
          <Table data-testid="delivery-log-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('deliveryColEvent')}</TableHead>
                <TableHead>{t('deliveryColEventId')}</TableHead>
                <TableHead>{t('deliveryColOccurredAt')}</TableHead>
                <TableHead>{t('deliveryColAttempts')}</TableHead>
                <TableHead>{t('deliveryColStatus')}</TableHead>
                <TableHead>{t('deliveryColLastHttp')}</TableHead>
                <TableHead>{t('deliveryColNextRetry')}</TableHead>
                <TableHead>{t('deliveryColActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const alreadyRetried = retriedIds.has(row.id)
                const rowError = retryErrorByRow[row.id]
                const isHighlighted = highlightDeliveryId != null && row.id === highlightDeliveryId
                return (
                  <TableRow
                    key={row.id}
                    data-testid={`delivery-row-${row.id}`}
                    data-highlighted={isHighlighted ? 'true' : undefined}
                    className={isHighlighted ? 'ring-2 ring-primary' : undefined}
                  >
                    <TableCell>{row.eventType ?? tc('unknown')}</TableCell>
                    <TableCell>{row.eventId}</TableCell>
                    <TableCell>{row.occurredAt ?? '—'}</TableCell>
                    <TableCell>{row.attempts}</TableCell>
                    <TableCell>{t(deliveryStatusLabelKey(row.status))}</TableCell>
                    <TableCell>{row.lastHttpStatus ?? '—'}</TableCell>
                    <TableCell>{row.nextRetryAt ?? '—'}</TableCell>
                    <TableCell>
                      {canRetryRow(row.status, alreadyRetried) && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={retryingId === row.id}
                          onClick={() => onRetry(row.id)}
                          data-testid={`delivery-retry-${row.id}`}
                        >
                          {retryingId === row.id ? t('deliveryRetryPending') : t('deliveryRetryButton')}
                        </Button>
                      )}
                      {row.status === 'dead_lettered' && alreadyRetried && !rowError && (
                        <span className="text-xs text-muted-foreground" data-testid={`delivery-retried-${row.id}`}>
                          {t('deliveryRetried')}
                        </span>
                      )}
                      {rowError && (
                        <p className="text-xs text-destructive" data-testid={`delivery-retry-error-${row.id}`}>
                          {t(retryDeliveryErrorMessageKey(rowError))}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        {hasMore && (
          <Button variant="outline" onClick={onLoadMore} disabled={loadingMore} data-testid="delivery-load-more">
            {loadingMore ? tc('loading') : t('deliveryLoadMore')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function DeliveryLogTable({
  integrationId,
  isAdmin,
  outboundSecretUpdatedAt,
  highlightDeliveryId,
}: {
  integrationId: string
  isAdmin: boolean
  outboundSecretUpdatedAt: string | null
  highlightDeliveryId?: string | null
}) {
  const [rows, setRows] = useState<IntegrationDeliveryListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<IntegrationDeliveryStatus | 'all'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retriedIds, setRetriedIds] = useState<Set<string>>(new Set())
  const [retryErrorByRow, setRetryErrorByRow] = useState<Record<string, string>>({})
  const [deadLetteredCreatedAts, setDeadLetteredCreatedAts] = useState<string[]>([])

  const loadFirstPage = useCallback(
    (filter: IntegrationDeliveryStatus | 'all') => {
      return fetchIntegrationDeliveries(integrationId, { status: filter === 'all' ? undefined : filter }).then(
        (result) => {
          if (result.ok) {
            setRows(result.data)
            setNextCursor(result.nextCursor)
            setLoadError(null)
          } else {
            setLoadError(result.error)
          }
          setIsLoading(false)
        }
      )
    },
    [integrationId]
  )

  // No synchronous setState before the first `.then()` here (matches
  // `use-integrations.ts`'s own documented react-hooks-compiler
  // `set-state-in-effect` workaround) -- `loadFirstPage` itself flips
  // `isLoading` false once its promise resolves; `isLoading`'s initial
  // value (`true`) covers the first mount. A later status-filter change
  // therefore keeps the previous page visible until the new one arrives,
  // rather than flashing a loading state -- a deliberate, minor UX
  // simplification, not a correctness gap.
  useEffect(() => {
    if (!isAdmin) return
    loadFirstPage(statusFilter)
  }, [isAdmin, statusFilter, loadFirstPage])

  // Separate, small fetch purely to compute the "N dead-lettered since
  // secret change" notice -- independent of the user's own status filter
  // selection above, so switching the filter never hides/reveals it.
  useEffect(() => {
    if (!isAdmin) return
    fetchIntegrationDeliveries(integrationId, { status: 'dead_lettered' }).then((result) => {
      if (result.ok) setDeadLetteredCreatedAts(result.data.map((d) => d.createdAt))
    })
  }, [isAdmin, integrationId])

  const onStatusFilterChange = (value: IntegrationDeliveryStatus | 'all') => {
    setStatusFilter(value)
  }

  const onLoadMore = () => {
    if (!nextCursor) return
    setLoadingMore(true)
    fetchIntegrationDeliveries(integrationId, {
      status: statusFilter === 'all' ? undefined : statusFilter,
      cursor: nextCursor,
    }).then((result) => {
      if (result.ok) {
        setRows((prev) => [...prev, ...result.data])
        setNextCursor(result.nextCursor)
      }
      setLoadingMore(false)
    })
  }

  const onRetry = async (deliveryId: string) => {
    setRetryingId(deliveryId)
    const result = await retryDeliveryRequest(integrationId, deliveryId)
    setRetryingId(null)
    // Disabled after ONE retry attempt regardless of outcome (US-9: "retry
    // once per event") -- success optimistically flips the row to
    // `queued`; `already_retried` (or any other error) leaves the row's
    // status as-is but still retires the button.
    setRetriedIds((prev) => new Set(prev).add(deliveryId))
    if (result.ok) {
      setRows((prev) => prev.map((row) => (row.id === deliveryId ? { ...row, status: 'queued' } : row)))
      return
    }
    setRetryErrorByRow((prev) => ({ ...prev, [deliveryId]: result.error }))
  }

  const deadLetteredNoticeCount = deadLetteredSinceSecretChangeCount(deadLetteredCreatedAts, outboundSecretUpdatedAt)

  return (
    <DeliveryLogView
      rows={rows}
      statusFilter={statusFilter}
      onStatusFilterChange={onStatusFilterChange}
      isLoading={isLoading}
      loadError={loadError}
      retryingId={retryingId}
      retriedIds={retriedIds}
      retryErrorByRow={retryErrorByRow}
      onRetry={onRetry}
      hasMore={nextCursor !== null}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
      deadLetteredNoticeCount={deadLetteredNoticeCount}
      highlightDeliveryId={highlightDeliveryId}
    />
  )
}
