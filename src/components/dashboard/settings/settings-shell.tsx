'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter, useSelectedLayoutSegment } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SettingsIndex, SettingsNav } from './settings-nav'
import { useFlaggedReceiptCount } from './use-flagged-receipt-count'
import {
  DEFAULT_SETTINGS_GROUP,
  resolveSettingsGroup,
  settingsGroupHref,
  visibleSettingsGroups,
} from './settings-groups'

const DESKTOP_QUERY = '(min-width: 768px)'

/**
 * Desktop (md+): header, sub-nav and the selected group; /dashboard/setup
 * goes to the first group. Phone: /dashboard/setup is the index; a group page
 * has a "‹ Settings" back link instead of the header.
 */
export function SettingsShell({ role, children }: { role: string; children: React.ReactNode }) {
  const t = useTranslations('settings')
  const tg = useTranslations('settingsGroups')
  const router = useRouter()
  const segment = useSelectedLayoutSegment()
  const groups = visibleSettingsGroups(role)
  const active = segment ? resolveSettingsGroup(segment, role) : null
  const flagged = useFlaggedReceiptCount()

  useEffect(() => {
    if (segment || !window.matchMedia(DESKTOP_QUERY).matches) return
    router.replace(settingsGroupHref(DEFAULT_SETTINGS_GROUP))
  }, [segment, router])

  return (
    <div className="space-y-6">
      {segment ? (
        <Link href="/dashboard/setup" data-testid="settings-back" className="inline-flex items-center gap-1 text-sm font-medium text-primary md:hidden">
          <ChevronLeft className="h-4 w-4" />
          {tg('back')}
        </Link>
      ) : null}
      <div className={cn(segment && 'hidden md:block')}>
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>
      {segment ? null : (
        <div className="md:hidden">
          <SettingsIndex groups={groups} flagged={flagged} />
        </div>
      )}
      <div className="flex gap-10">
        <div className="hidden md:block">
          <SettingsNav groups={groups} active={active} flagged={flagged} />
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
