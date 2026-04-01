'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { TenantSwitcher } from '@/components/dashboard/tenant-switcher'

function NavLink({ href, label, isActive, onClick }: {
  href: string
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors mb-1',
        isActive
          ? 'bg-sidebar-accent text-white border-l-2 border-sidebar-primary'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white'
      )}
    >
      {label}
    </Link>
  )
}

function HamburgerButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-md bg-sidebar text-sidebar-foreground"
      onClick={onToggle}
      aria-label="Toggle menu"
    >
      <span className="block w-5 h-0.5 bg-current mb-1" />
      <span className="block w-5 h-0.5 bg-current mb-1" />
      <span className="block w-5 h-0.5 bg-current" />
    </button>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeMobile = () => setMobileOpen(false)
  const t = useTranslations('nav')

  const navItems = [
    { label: t('overview'), href: '/dashboard' },
    { label: t('members'), href: '/dashboard/members' },
    { label: t('liveFeed'), href: '/dashboard/feed' },
    { label: t('campaigns'), href: '/dashboard/campaigns' },
    { label: t('waTemplates'), href: '/dashboard/wa-templates' },
    { label: t('coupons'), href: '/dashboard/coupons' },
    { label: t('scan'), href: '/dashboard/scan' },
    { label: t('rewards'), href: '/dashboard/rewards' },
  ]

  const secondaryItems = [
    { label: t('qrSetup'), href: '/dashboard/setup' },
  ]

  return (
    <>
      <HamburgerButton open={mobileOpen} onToggle={() => setMobileOpen(!mobileOpen)} />

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={closeMobile}
        />
      )}

      <aside className={cn(
        'bg-sidebar text-sidebar-foreground flex flex-col shrink-0 transition-all duration-200 z-40',
        'hidden lg:flex lg:w-60',
        mobileOpen && 'fixed inset-y-0 left-0 flex w-60'
      )}>
        <div className="p-6 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{t('brandName')}</h2>
            <p className="text-sm text-sidebar-foreground/60 mt-1">{t('brandSubtitle')}</p>
          </div>
          <TenantSwitcher />
        </div>
        <nav className="flex-1 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              isActive={pathname === item.href}
              onClick={closeMobile}
            />
          ))}
          <div className="my-4 border-t border-sidebar-border" />
          {secondaryItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              isActive={pathname === item.href}
              onClick={closeMobile}
            />
          ))}
        </nav>
      </aside>
    </>
  )
}
