'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useReferrerReport } from '@/hooks/use-referrer-report'
import { generateCommissionCsv, downloadCsv } from './csv-export'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CommissionTable } from './commission-table'

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

interface SummaryTotals {
  totalCommission: number
  totalBroadcastCommission: number
  totalRedemptionCommission: number
  tenantsProcessed: number
}

export default function CommissionReportPage() {
  const t = useTranslations('admin')
  const [month, setMonth] = useState(() => formatMonth(new Date()))
  const { data, loading, error, refetch } = useReferrerReport(month)
  const [generating, setGenerating] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    await refetch()
    setGenerating(false)
  }

  function handleExport() {
    if (!data) return
    const csv = generateCommissionCsv(data.commissions)
    downloadCsv(csv, `commission-report-${month}.csv`)
  }

  return (
    <div className="space-y-6">
      <Header
        t={t}
        generating={generating}
        hasData={!!data?.commissions.length}
        onGenerate={handleGenerate}
        onExport={handleExport}
      />
      <MonthNav month={month} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} />
      {loading && <p className="text-muted-foreground">{t('generating')}</p>}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {data && (
        <SummaryCards
          t={t}
          totals={{
            totalCommission: data.totalCommission,
            totalBroadcastCommission: data.totalBroadcastCommission,
            totalRedemptionCommission: data.totalRedemptionCommission,
            tenantsProcessed: data.tenantsProcessed,
          }}
        />
      )}
      {data && (
        <CommissionTable
          t={t}
          commissions={data.commissions}
          totals={{
            totalCommission: data.totalCommission,
            totalBroadcastCommission: data.totalBroadcastCommission,
            totalRedemptionCommission: data.totalRedemptionCommission,
          }}
        />
      )}
    </div>
  )
}

function Header({ t, generating, hasData, onGenerate, onExport }: {
  t: ReturnType<typeof useTranslations<'admin'>>
  generating: boolean; hasData: boolean
  onGenerate: () => void; onExport: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold text-foreground">{t('commissionReportHeading')}</h1>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onGenerate} disabled={generating}>
          {generating ? t('generating') : t('generateReport')}
        </Button>
        <Button variant="outline" onClick={onExport} disabled={!hasData}>
          {t('exportCsv')}
        </Button>
      </div>
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

function SummaryCards({ t, totals }: {
  t: ReturnType<typeof useTranslations<'admin'>>; totals: SummaryTotals
}) {
  const cards = [
    { title: t('totalCommissionAmount'), value: formatHKD(totals.totalCommission) },
    { title: t('totalBroadcastCommission'), value: formatHKD(totals.totalBroadcastCommission) },
    { title: t('totalRedemptionCommission'), value: formatHKD(totals.totalRedemptionCommission) },
    { title: t('tenantsProcessed'), value: totals.tenantsProcessed.toString() },
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.title} size="sm">
          <CardHeader><CardTitle>{card.title}</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{card.value}</p></CardContent>
        </Card>
      ))}
    </div>
  )
}
