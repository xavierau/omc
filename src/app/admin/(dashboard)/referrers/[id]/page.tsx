'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useReferrerDetail } from '@/hooks/use-referrer-detail'
import { ReferrerFormDialog } from '@/components/admin/referrer-form-dialog'
import { ReferrerCommissionTable } from '@/components/admin/referrer-commission-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function ReferrerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { referrer, earnings, commissions, isLoading, error, mutate } = useReferrerDetail(id)
  const [editOpen, setEditOpen] = useState(false)

  if (isLoading) return <p className="text-muted-foreground">{tc('loading')}</p>

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">{t('couldntLoad')}</p>
        <Button variant="outline" onClick={mutate} className="mt-4">{tc('retry')}</Button>
      </div>
    )
  }

  if (!referrer) return <p className="text-muted-foreground">{t('referrerNotFound')}</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/referrers" className="text-muted-foreground hover:text-foreground text-sm">
            {t('backToReferrers')}
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-2xl font-semibold text-foreground">{referrer.name}</h1>
        </div>
        <Button onClick={() => setEditOpen(true)}>{tc('edit')}</Button>
      </div>
      <EarningsCards
        totalEarned={earnings?.total ?? 0}
        pending={earnings?.pending ?? 0}
        totalBroadcast={earnings?.totalBroadcast ?? 0}
        totalRedemption={earnings?.totalRedemption ?? 0}
      />
      <div>
        <h2 className="text-lg font-semibold mb-3">{t('commissionHistory')}</h2>
        {commissions.length === 0 ? (
          <p className="text-muted-foreground">{t('noCommissions')}</p>
        ) : (
          <ReferrerCommissionTable commissions={commissions} />
        )}
      </div>
      <ReferrerFormDialog open={editOpen} onClose={() => setEditOpen(false)} onSaved={mutate} referrer={referrer} />
    </div>
  )
}

interface EarningsCardsProps {
  totalEarned: number
  pending: number
  totalBroadcast: number
  totalRedemption: number
}

function EarningsCards({ totalEarned, pending, totalBroadcast, totalRedemption }: EarningsCardsProps) {
  const t = useTranslations('admin')
  const cards = [
    { title: t('totalEarned'), value: totalEarned },
    { title: t('pendingAmount'), value: pending },
    { title: t('broadcastEarnings'), value: totalBroadcast },
    { title: t('redemptionEarnings'), value: totalRedemption },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{`HK$${card.value.toFixed(2)}`}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
