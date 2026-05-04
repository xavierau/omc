// WAQ-012: platform-admin quality overview page. Lists every tenant with
// rating + 7-day KPIs at a glance. Filtering / sorting controls and the
// per-tenant click-through are intentionally deferred to a follow-up
// (the spec marks both as out of scope for this slice).

'use client'

import { useQualityOverview, type TenantQualityRow } from '@/hooks/use-quality-overview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function formatPct(rate: number): string {
  if (!Number.isFinite(rate) || rate === 0) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

function ratingTone(
  rating: TenantQualityRow['qualityRating']
): 'green' | 'yellow' | 'red' | 'gray' {
  if (rating === 'GREEN') return 'green'
  if (rating === 'YELLOW') return 'yellow'
  if (rating === 'RED') return 'red'
  return 'gray'
}

function RatingBadge({ rating }: { rating: TenantQualityRow['qualityRating'] }) {
  const tone = ratingTone(rating)
  // Use background color tokens so we get a colored pill; fall back to muted
  // for UNKNOWN. Class names are static so Tailwind can pick them up.
  const className =
    tone === 'green'
      ? 'bg-green-500/15 text-green-700 dark:text-green-300'
      : tone === 'yellow'
        ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300'
        : tone === 'red'
          ? 'bg-red-500/15 text-red-700 dark:text-red-300'
          : 'bg-muted text-muted-foreground'
  return (
    <Badge variant="outline" className={className}>
      {rating}
    </Badge>
  )
}

function PauseBadge({ active }: { active: boolean }) {
  if (!active) return <span className="text-muted-foreground">—</span>
  return <Badge variant="destructive">Auto-paused</Badge>
}

function QualityRow({ row }: { row: TenantQualityRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{row.restaurantName}</TableCell>
      <TableCell><RatingBadge rating={row.qualityRating} /></TableCell>
      <TableCell>{row.messagingTier ?? '—'}</TableCell>
      <TableCell className="text-right">{formatPct(row.kpis.deliveryRate)}</TableCell>
      <TableCell className="text-right">{formatPct(row.kpis.readRate)}</TableCell>
      <TableCell className="text-right">{formatPct(row.kpis.errorRate)}</TableCell>
      <TableCell className="text-right">{formatPct(row.kpis.optOutRate)}</TableCell>
      <TableCell><PauseBadge active={row.autoPauseActive} /></TableCell>
    </TableRow>
  )
}

function QualityTable({ rows }: { rows: TenantQualityRow[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground">No tenants found.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Restaurant</TableHead>
          <TableHead>Rating</TableHead>
          <TableHead>Tier</TableHead>
          <TableHead className="text-right">Delivery</TableHead>
          <TableHead className="text-right">Read</TableHead>
          <TableHead className="text-right">Error</TableHead>
          <TableHead className="text-right">Opt-out</TableHead>
          <TableHead>Auto-pause</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => <QualityRow key={r.restaurantId} row={r} />)}
      </TableBody>
    </Table>
  )
}

export default function AdminQualityPage() {
  const { data, isLoading, error, refetch } = useQualityOverview()

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh]">
        <p className="text-muted-foreground">Couldn&apos;t load quality data.</p>
        <Button variant="outline" onClick={refetch} className="mt-4">Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Quality Overview</h1>
        <span className="text-sm text-muted-foreground">
          {data ? `Last ${data.windowDays}d` : ''}
        </span>
      </div>
      {isLoading && <p className="text-muted-foreground">Loading...</p>}
      {!isLoading && data && <QualityTable rows={data.rows} />}
    </div>
  )
}
