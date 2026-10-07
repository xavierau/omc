'use client'

import { useTranslations } from 'next-intl'
import type { KpiGateView } from '@/hooks/use-admin-tenant-onboarding'
import {
  kpiTileVariant,
  type KpiMetric,
  type KpiTileVariant,
} from '@/components/admin/onboarding/onboarding-view-helpers'

interface KpiGateSummaryProps {
  gate: KpiGateView
}

const TILE_CLASS: Record<KpiTileVariant, string> = {
  pass: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  fail: 'border-destructive/30 bg-destructive/5 text-destructive',
  insufficient: 'border-amber-200 bg-amber-50 text-amber-900',
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function tileValue(gate: KpiGateView, metric: KpiMetric): string {
  if (gate.status === 'insufficient') return '—'
  return formatPercent(metric === 'delivery' ? gate.deliveryRate : gate.optOutRate)
}

function badgeText(
  gate: KpiGateView,
  metric: KpiMetric,
  t: (key: string, values?: Record<string, number>) => string
): string {
  if (gate.status === 'insufficient') {
    return t('kpi.insufficient', { count: gate.observed, min: gate.required })
  }
  return kpiTileVariant(gate, metric) === 'pass' ? t('kpi.pass') : t('kpi.fail')
}

export function KpiGateSummary({ gate }: KpiGateSummaryProps) {
  const t = useTranslations('admin.onboarding')
  const tiles: { metric: KpiMetric; label: string; threshold: string }[] = [
    { metric: 'delivery', label: t('kpi.delivery'), threshold: `${t('kpi.threshold')} ≥ 95%` },
    { metric: 'opt_out', label: t('kpi.optOut'), threshold: `${t('kpi.threshold')} < 2%` },
  ]
  const insufficient = gate.status === 'insufficient'
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {tiles.map(({ metric, label, threshold }) => {
        const variant = kpiTileVariant(gate, metric)
        return (
          <div
            key={metric}
            data-metric={metric}
            data-variant={variant}
            data-insufficient-observed={insufficient ? gate.observed : undefined}
            data-insufficient-required={insufficient ? gate.required : undefined}
            className={`flex flex-col gap-1 rounded-lg border px-4 py-3 ${TILE_CLASS[variant]}`}
          >
            <span className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</span>
            <span className="text-2xl font-semibold">{tileValue(gate, metric)}</span>
            <span className="text-xs opacity-70">{threshold}</span>
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-white/60 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide">
              {badgeText(gate, metric, t)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
