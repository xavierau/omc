'use client'

import { useTranslations } from 'next-intl'
import { WizardContainer } from '@/components/admin/onboarding-wizard'

export default function NewTenantPage() {
  const t = useTranslations('admin')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('newTenantHeading')}</h1>
      <WizardContainer />
    </div>
  )
}
