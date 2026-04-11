'use client'

import { useState } from 'react'
import { useCampaignUsage } from '@/hooks/use-campaign-usage'
import { toHKD, type CampaignUsageSummary } from '@/domain/services/campaign-cost'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function formatMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return formatMonth(d)
}

function formatHKD(amount: number): string {
  return `HK$${amount.toFixed(2)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-HK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function CampaignSpendWidget({ tenantId }: { tenantId: string }) {
  const [month, setMonth] = useState(() => formatMonth(new Date()))
  const { data, loading, error } = useCampaignUsage(tenantId, month)

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Campaign Spend</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MonthNav month={month} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} />
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {data && <SpendSummary totalSent={data.totalSent} totalCost={data.totalEstimatedCost} />}
        {data && <CampaignTable campaigns={data.campaigns} />}
      </CardContent>
    </Card>
  )
}

function MonthNav({ month, onPrev, onNext }: { month: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onPrev}>&larr;</Button>
      <span className="text-sm font-medium">{month}</span>
      <Button variant="outline" size="sm" onClick={onNext}>&rarr;</Button>
    </div>
  )
}

function SpendSummary({ totalSent, totalCost }: { totalSent: number; totalCost: number }) {
  return (
    <div className="flex gap-6 text-sm">
      <div>
        <span className="text-muted-foreground">Messages sent:</span>{' '}
        <strong>{totalSent.toLocaleString()}</strong>
      </div>
      <div>
        <span className="text-muted-foreground">Est. cost:</span>{' '}
        <strong>{formatHKD(toHKD(totalCost))}</strong>
      </div>
    </div>
  )
}

function CampaignTable({ campaigns }: { campaigns: CampaignUsageSummary[] }) {
  if (campaigns.length === 0) {
    return <p className="text-sm text-muted-foreground">No campaigns this month.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Messages</TableHead>
          <TableHead className="text-right">Est. Cost (HKD)</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {campaigns.map((c) => (
          <TableRow key={c.campaignId}>
            <TableCell>{c.campaignName}</TableCell>
            <TableCell className="text-right">{c.sentCount.toLocaleString()}</TableCell>
            <TableCell className="text-right">{formatHKD(toHKD(c.estimatedCost))}</TableCell>
            <TableCell>{formatDate(c.executedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
