'use client'

import { use } from 'react'
import { useTranslations } from 'next-intl'
import { useAdminTenantDetail } from '@/hooks/use-admin-tenant-detail'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TenantSettingsTab } from '@/components/admin/tenant-settings-tab'
import { TenantUsersTab } from '@/components/admin/tenant-users-tab'
import { TenantMetricsTab } from '@/components/admin/tenant-metrics-tab'
import { Button } from '@/components/ui/button'

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { tenant, users, metrics, isLoading, error, mutate } = useAdminTenantDetail(id)

  if (isLoading) {
    return <p className="text-muted-foreground">{tc('loading')}</p>
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">{t('couldntLoad')}</p>
        <Button variant="outline" onClick={mutate} className="mt-4">{tc('retry')}</Button>
      </div>
    )
  }

  if (!tenant) {
    return <p className="text-muted-foreground">{t('tenantNotFound')}</p>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{tenant.name}</h1>
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">{t('settingsTab')}</TabsTrigger>
          <TabsTrigger value="users">{t('usersTab')}</TabsTrigger>
          <TabsTrigger value="metrics">{t('metricsTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="mt-4">
          <TenantSettingsTab tenant={tenant} onSaved={mutate} />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <TenantUsersTab tenantId={id} users={users} onMutate={mutate} />
        </TabsContent>
        <TabsContent value="metrics" className="mt-4">
          {metrics && <TenantMetricsTab metrics={metrics} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}
