'use client'

import { useTranslations } from 'next-intl'
import { PlatformStatCard } from '@/components/admin/platform-stat-card'
import type { TenantMetrics } from '@/hooks/use-admin-tenant-detail'

interface TenantMetricsTabProps {
  metrics: TenantMetrics
}

export function TenantMetricsTab({ metrics }: TenantMetricsTabProps) {
  const t = useTranslations('admin')

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <PlatformStatCard value={metrics.memberCount} label={t('memberCount')} />
      <PlatformStatCard value={metrics.receiptCount} label={t('receiptCount')} />
      <PlatformStatCard value={metrics.couponRedemptions} label={t('couponRedemptions')} />
    </div>
  )
}
