'use client'

import { useState } from 'react'
import { useBillingReport } from '@/hooks/use-billing-report'
import { generateBillingCsv, downloadCsv } from './csv-export'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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

export default function BillingPage() {
  const [month, setMonth] = useState(() => formatMonth(new Date()))
  const { data, loading, error, refetch } = useBillingReport(month)

  function handleExport() {
    if (!data) return
    const csv = generateBillingCsv(data.tenants)
    downloadCsv(csv, `billing-${month}.csv`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Billing Report</h1>
        <Button variant="outline" onClick={handleExport} disabled={!data?.tenants.length}>
          Export CSV
        </Button>
      </div>

      <MonthNav month={month} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} />

      {loading && <p className="text-muted-foreground">Loading...</p>}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {data && <SummaryCards totalMessages={data.totalMessages} totalCostHkd={data.totalCostHkd} />}
      {data && <BillingTable tenants={data.tenants} totalMessages={data.totalMessages} totalCostHkd={data.totalCostHkd} />}
    </div>
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

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh]">
      <p className="text-muted-foreground">{error}</p>
      <Button variant="outline" onClick={onRetry} className="mt-4">Retry</Button>
    </div>
  )
}

function SummaryCards({ totalMessages, totalCostHkd }: { totalMessages: number; totalCostHkd: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card size="sm">
        <CardHeader><CardTitle>Total Messages Sent</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold">{totalMessages.toLocaleString()}</p></CardContent>
      </Card>
      <Card size="sm">
        <CardHeader><CardTitle>Total Cost (HKD)</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold">{formatHKD(totalCostHkd)}</p></CardContent>
      </Card>
    </div>
  )
}

function BillingTable({ tenants, totalMessages, totalCostHkd }: {
  tenants: { tenantName: string; plan: string; campaignsRun: number; messagesSent: number; estimatedCostHkd: number }[]
  totalMessages: number
  totalCostHkd: number
}) {
  if (tenants.length === 0) {
    return <p className="text-muted-foreground">No billing data for this month.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tenant Name</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead className="text-right">Campaigns</TableHead>
          <TableHead className="text-right">Messages Sent</TableHead>
          <TableHead className="text-right">Est. Cost (HKD)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tenants.map((t) => (
          <TableRow key={t.tenantName}>
            <TableCell>{t.tenantName}</TableCell>
            <TableCell className="capitalize">{t.plan}</TableCell>
            <TableCell className="text-right">{t.campaignsRun}</TableCell>
            <TableCell className="text-right">{t.messagesSent.toLocaleString()}</TableCell>
            <TableCell className="text-right">{formatHKD(t.estimatedCostHkd)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3} className="font-medium">Total</TableCell>
          <TableCell className="text-right font-medium">{totalMessages.toLocaleString()}</TableCell>
          <TableCell className="text-right font-medium">{formatHKD(totalCostHkd)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
