'use client'

import { useTenant } from '@/hooks/use-tenant'
import { useTranslations } from 'next-intl'

function TenantSelector({ restaurants, activeId, onSwitch }: {
  restaurants: { id: string; name: string }[]
  activeId: string | null
  onSwitch: (id: string) => void
}) {
  return (
    <select
      value={activeId ?? ''}
      onChange={(e) => onSwitch(e.target.value)}
      className="w-full rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sidebar-primary"
    >
      {restaurants.map((r) => (
        <option key={r.id} value={r.id} className="bg-sidebar text-white">
          {r.name}
        </option>
      ))}
    </select>
  )
}

export function TenantSwitcher() {
  const { restaurants, restaurantId, restaurantName, switchTenant } = useTenant()
  const t = useTranslations('common')

  if (restaurants.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-sidebar-foreground/50">
        {t('loading')}
      </div>
    )
  }

  if (restaurants.length === 1) {
    return (
      <div className="px-3 py-2 text-sm font-medium text-white truncate">
        {restaurantName}
      </div>
    )
  }

  return (
    <TenantSelector
      restaurants={restaurants}
      activeId={restaurantId}
      onSwitch={switchTenant}
    />
  )
}
