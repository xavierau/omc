'use client'

import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useDashboardOverview } from '@/hooks/use-dashboard-overview'
import { HeroStat } from '@/components/dashboard/hero-stat'
import { StatCard } from '@/components/dashboard/stat-card'
import { MiniFeed } from '@/components/dashboard/mini-feed'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import {
  HeroStatSkeleton,
  StatCardSkeleton,
  MiniFeedSkeleton,
} from '@/components/shared/loading-skeleton'

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboardOverview()
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">{t('dataDelayed')}</p>
        <Button variant="outline" onClick={refetch} className="mt-4">
          {tc('retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>

      {!isLoading && !data?.kapsoPhoneNumberId && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-amber-800 dark:text-amber-200">{t('whatsappNotConnected')}</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">{t('whatsappNotConnectedHint')}</p>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/dashboard/settings">{t('connectWhatsApp')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <HeroStatSkeleton />
      ) : (
        <HeroStat value={data?.newMembersToday ?? 0} label={t('newMembersToday')} />
      )}

      <div className={cn(
        'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums',
        !isLoading && 'animate-fade-in-up'
      )}>
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard value={data?.totalMembers ?? 0} label={t('totalMembers')} />
            <StatCard value={data?.totalPointsIssued?.toLocaleString() ?? '0'} label={t('pointsIssued')} />
            <StatCard value={data?.activeCampaigns ?? 0} label={t('activeCampaigns')} />
            <StatCard value={`${data?.redemptionRate?.toFixed(0) ?? 0}%`} label={t('redemptionRate')} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">{t('recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <MiniFeedSkeleton />
            ) : (
              <MiniFeed events={data?.recentEvents?.map(e => ({
                id: e.id,
                type: e.type,
                memberName: e.memberName,
                createdAt: e.createdAt,
              })) ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('quickActions')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild className="w-full">
              <Link href="/dashboard/scan">{t('scanQrCode')}</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/dashboard/setup">{t('generateQrCode')}</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/dashboard/members">{t('viewAllMembers')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
