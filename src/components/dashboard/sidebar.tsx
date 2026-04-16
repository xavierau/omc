'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LayoutDashboard, Users, Radio, Megaphone, MessageSquare, Ticket, QrCode, Gift, Settings, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TenantSwitcher } from '@/components/dashboard/tenant-switcher'

function NavLink({ href, label, icon: Icon, isActive, onClick }: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  isActive: boolean
  onClick: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors mb-1',
        isActive
          ? 'bg-sidebar-accent text-white border-l-2 border-sidebar-primary'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  )
}

function HamburgerButton({ onToggle }: { onToggle: () => void }) {
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
    { label: t('overview'), href: '/dashboard', icon: LayoutDashboard },
    { label: t('members'), href: '/dashboard/members', icon: Users },
    { label: t('liveFeed'), href: '/dashboard/feed', icon: Radio },
    { label: t('campaigns'), href: '/dashboard/campaigns', icon: Megaphone },
    { label: t('waTemplates'), href: '/dashboard/wa-templates', icon: MessageSquare },
    { label: t('coupons'), href: '/dashboard/coupons', icon: Ticket },
    { label: t('scan'), href: '/dashboard/scan', icon: QrCode },
    { label: t('rewards'), href: '/dashboard/rewards', icon: Gift },
  ]

  const secondaryItems = [
    { label: t('qrSetup'), href: '/dashboard/setup', icon: Settings },
  ]

  return (
    <>
      <HamburgerButton onToggle={() => setMobileOpen(!mobileOpen)} />

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
            <h2 className="text-lg font-bold tracking-tight text-white">OhMyClient</h2>
            <p className="text-xs text-sidebar-foreground/50 mt-1">{t('brandSubtitle')}</p>
          </div>
          <TenantSwitcher />
        </div>
        <nav className="flex-1 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
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
              icon={item.icon}
              isActive={pathname === item.href}
              onClick={closeMobile}
            />
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <button
            onClick={() => {
              document.cookie = 'x-tenant-id=;path=/;max-age=0'
              window.location.href = '/login'
            }}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white transition-colors w-full"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {t('logout')}
          </button>
        </div>
      </aside>
    </>
  )
}
