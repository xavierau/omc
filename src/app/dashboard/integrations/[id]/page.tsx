'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useIntegrationDetail } from '@/hooks/use-integrations'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { IntegrationDetailHeader } from '@/components/dashboard/integrations/integration-detail-header'
import { InboundCredentialsCard } from '@/components/dashboard/integrations/inbound-credentials-card'
import { WelcomeTemplateCard } from '@/components/dashboard/integrations/welcome-template-card'
import { ConsentAttestationCard } from '@/components/dashboard/integrations/consent-attestation-card'
import { OutboundWebhookCard } from '@/components/dashboard/integrations/outbound-webhook-card'
import { PausedBannerCard } from '@/components/dashboard/integrations/paused-banner'
import { DeliveryLogTable } from '@/components/dashboard/integrations/delivery-log-table'
import { ActivityLogTable } from '@/components/dashboard/integrations/activity-log-table'

type DetailTab = 'settings' | 'deliveries' | 'activity'

export default function IntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('integrations')
  const tc = useTranslations('common')
  const { integration, settings, isAdmin, isLoading, notFound, error, mutate } = useIntegrationDetail(id)
  const [activeTab, setActiveTab] = useState<DetailTab>('settings')
  const [highlightDeliveryId, setHighlightDeliveryId] = useState<string | null>(null)

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">{t('loadFailed')}</p>
        <Button variant="outline" onClick={mutate} className="mt-4">{tc('retry')}</Button>
      </div>
    )
  }

  if (notFound || !integration) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">{t('notFound')}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/dashboard/integrations">{t('backToList')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <IntegrationDetailHeader integration={integration} />

      {isAdmin && settings && (
        <PausedBannerCard
          integrationId={id}
          outboundStatus={settings.outboundStatus}
          failureStreak={settings.outboundFailureStreak}
          onResumed={mutate}
        />
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DetailTab)}>
        <TabsList>
          <TabsTrigger value="settings">{t('tabSettings')}</TabsTrigger>
          <TabsTrigger value="deliveries">{t('tabDeliveries')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabActivity')}</TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="space-y-6 mt-4">
          <InboundCredentialsCard integration={integration} isAdmin={isAdmin} />
          {isAdmin && settings && (
            <>
              <WelcomeTemplateCard integrationId={id} initialSettings={settings} />
              <ConsentAttestationCard integrationId={id} initialSettings={settings} />
              <OutboundWebhookCard
                integrationId={id}
                initialSettings={settings}
                onViewDelivery={(deliveryId) => {
                  setHighlightDeliveryId(deliveryId)
                  setActiveTab('deliveries')
                }}
              />
            </>
          )}
          {!isAdmin && (
            <p className="text-sm text-muted-foreground" data-testid="settings-admin-only">
              {t('adminOnlySettings')}
            </p>
          )}
        </TabsContent>
        <TabsContent value="deliveries" className="mt-4">
          {isAdmin && settings ? (
            <DeliveryLogTable
              integrationId={id}
              isAdmin={isAdmin}
              outboundSecretUpdatedAt={settings.outboundSecretUpdatedAt}
              highlightDeliveryId={highlightDeliveryId}
            />
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="deliveries-admin-only">
              {t('adminOnlySettings')}
            </p>
          )}
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          {isAdmin ? (
            <ActivityLogTable integrationId={id} />
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="activity-admin-only">
              {t('adminOnlySettings')}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
