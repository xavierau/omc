'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { settingsGroupHref, type SettingsGroup, type SettingsGroupId } from './settings-groups'
import { SettingsGroupBadge } from './settings-group-badge'

interface Props {
  groups: SettingsGroup[]
  active: SettingsGroupId | null
  flagged: number
}

function GroupText({ group, flagged }: { group: SettingsGroup; flagged: number }) {
  const t = useTranslations('settingsGroups')
  return (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
        {t(`${group.id}.label`)}
        <SettingsGroupBadge group={group} flagged={flagged} />
      </span>
      <span className="block text-sm text-muted-foreground">{t(`${group.id}.sub`)}</span>
    </span>
  )
}

/** Desktop/tablet: the 232px sub-nav beside the selected group. */
export function SettingsNav({ groups, active, flagged }: Props) {
  return (
    <nav aria-label="Settings" className="w-[232px] shrink-0 space-y-1">
      {groups.map((g) => (
        <Link
          key={g.id}
          href={settingsGroupHref(g.id)}
          aria-current={active === g.id ? 'page' : undefined}
          data-testid={`settings-nav-${g.id}`}
          className={cn(
            'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
            active === g.id ? 'border-border bg-card shadow-xs' : 'border-transparent hover:bg-muted'
          )}
        >
          <g.icon className={cn('mt-0.5 h-5 w-5 shrink-0', active === g.id ? 'text-primary' : 'text-muted-foreground')} />
          <GroupText group={g} flagged={flagged} />
        </Link>
      ))}
    </nav>
  )
}

/** Phone: the drill-down index shown at /dashboard/setup. */
export function SettingsIndex({ groups, flagged }: Omit<Props, 'active'>) {
  return (
    <nav aria-label="Settings" className="overflow-hidden rounded-xl border bg-card">
      {groups.map((g) => (
        <Link
          key={g.id}
          href={settingsGroupHref(g.id)}
          data-testid={`settings-index-row-${g.id}`}
          className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0 hover:bg-muted"
        >
          <g.icon className="h-6 w-6 shrink-0 text-muted-foreground" />
          <GroupText group={g} flagged={flagged} />
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </nav>
  )
}
