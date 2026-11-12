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
import { SettingsErrorPanel } from '@/components/dashboard/integrations/settings-error-panel'
import { resolveSettingsPanelState } from '@/components/dashboard/integrations/settings-panel-state'

type DetailTab = 'settings' | 'deliveries' | 'activity'

export default function IntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('integrations')
  const tc = useTranslations('common')
  const { integration, settings, settingsError, isAdmin, isLoading, notFound, error, mutate } =
    useIntegrationDetail(id)
  const [activeTab, setActiveTab] = useState<DetailTab>('settings')
  const [highlightDeliveryId, setHighlightDeliveryId] = useState<string | null>(null)
  // WI-15: replaces the old `isAdmin && settings` truthy gate at every
  // settings-dependent slot below (cards, paused banner, Deliveries tab) —
  // see tests/2026-09-10-int-001-ui-walk.md Anomalies #1/#2.
  const settingsPanelState = resolveSettingsPanelState(isAdmin, !!settings, settingsError?.status ?? null)

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
      {settingsPanelState === 'error' && settingsError && (
        <SettingsErrorPanel errorCode={settingsError.error} onRetry={mutate} testId="paused-banner-fetch-error" />
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
          {settingsPanelState === 'error' && settingsError && (
            <SettingsErrorPanel errorCode={settingsError.error} onRetry={mutate} testId="settings-fetch-error" />
          )}
          {settingsPanelState === 'roleMessage' && (
            <p className="text-sm text-muted-foreground" data-testid="settings-admin-only">
              {t('adminOnlySettings')}
            </p>
          )}
        </TabsContent>
        <TabsContent value="deliveries" className="mt-4">
          {isAdmin && settings && (
            <DeliveryLogTable
              integrationId={id}
              isAdmin={isAdmin}
              outboundSecretUpdatedAt={settings.outboundSecretUpdatedAt}
              highlightDeliveryId={highlightDeliveryId}
            />
          )}
          {settingsPanelState === 'error' && settingsError && (
            <SettingsErrorPanel errorCode={settingsError.error} onRetry={mutate} testId="deliveries-fetch-error" />
          )}
          {settingsPanelState === 'roleMessage' && (
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
