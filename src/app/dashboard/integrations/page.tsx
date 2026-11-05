'use client'

import { useTranslations } from 'next-intl'
import { useTenant } from '@/hooks/use-tenant'
import { isTenantAdmin } from '@/hooks/integrations-client'
import { IntegrationList } from '@/components/dashboard/integrations/integration-list'

export default function IntegrationsPage() {
  const t = useTranslations('integrations')
  const { restaurantId, restaurants } = useTenant()
  const isAdmin = isTenantAdmin(restaurants, restaurantId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>
      <IntegrationList isAdmin={isAdmin} />
    </div>
  )
}
