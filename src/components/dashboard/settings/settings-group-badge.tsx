'use client'

import { useTranslations } from 'next-intl'
import type { SettingsGroup } from './settings-groups'

export function SettingsGroupBadge({ group, flagged }: { group: SettingsGroup; flagged: number }) {
  const t = useTranslations('settingsGroups')
  if (group.badge === 'new') {
    return <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{t('newBadge')}</span>
  }
  if (group.badge === 'flagged' && flagged > 0) {
    return (
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
        {t('flagged', { count: flagged })}
      </span>
    )
  }
  return null
}
