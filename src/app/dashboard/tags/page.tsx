'use client'

import { useTranslations } from 'next-intl'
import { TagManager } from '@/components/dashboard/tag-manager'

export default function TagsPage() {
  const t = useTranslations('tags')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('manage')}</p>
      </div>
      <TagManager />
    </div>
  )
}
