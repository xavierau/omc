'use client'

import { useTranslations } from 'next-intl'
import { usePlatformOverview } from '@/hooks/use-platform-overview'
import { PlatformStatCard } from '@/components/admin/platform-stat-card'
import { TenantTable } from '@/components/admin/tenant-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCardSkeleton } from '@/components/shared/loading-skeleton'

export default function AdminOverviewPage() {
  const { data, isLoading, error, refetch } = usePlatformOverview()
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">{t('couldntLoad')}</p>
        <Button variant="outline" onClick={refetch} className="mt-4">{tc('retry')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
      <StatCardsGrid data={data} isLoading={isLoading} />
      {!isLoading && data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('recentTenants')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TenantTable tenants={data.recentTenants.map(rt => ({
              ...rt,
              phoneNumberId: null,
            }))} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatCardsGrid({ data, isLoading }: {
  data: ReturnType<typeof usePlatformOverview>['data']
  isLoading: boolean
}) {
  const t = useTranslations('admin')

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 7 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
    )
  }

  if (!data) return null

  const stats = [
    { value: data.totalTenants, label: t('totalTenants'), subtitle: `${data.activeTenants} active / ${data.inactiveTenants} inactive / ${data.trialTenants ?? 0} trial` },
    { value: data.trialTenants ?? 0, label: t('trialTenants') },
    { value: data.totalMembers, label: t('totalMembers') },
    { value: data.newMembers30d, label: t('newMembers30d') },
    { value: data.receiptsProcessed30d, label: t('receiptsProcessed30d') },
    { value: data.couponsRedeemed30d, label: t('couponsRedeemed30d') },
    { value: data.messagesSent30d, label: t('messagesSent30d') },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in-up">
      {stats.map((s) => (
        <PlatformStatCard key={s.label} value={s.value} label={s.label} subtitle={s.subtitle} />
      ))}
    </div>
  )
}
