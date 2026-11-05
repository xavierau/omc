'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { createAuthBrowserClient } from '@/infrastructure/supabase/auth-client'

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

export function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeMobile = () => setMobileOpen(false)
  const t = useTranslations('adminNav')

  const navItems = [
    { label: t('overview'), href: '/admin' },
    { label: t('tenants'), href: '/admin/tenants' },
    { label: t('quality'), href: '/admin/quality' },
    { label: t('templateReviews'), href: '/admin/template-reviews' },
    { label: t('billing'), href: '/admin/billing' },
    { label: t('referrers'), href: '/admin/referrers' },
    { label: t('commissionReport'), href: '/admin/referrers/report' },
    { label: t('auditLogs'), href: '/admin/audit-logs' },
  ]

  async function handleLogout() {
    const supabase = createAuthBrowserClient()
    await supabase.auth.signOut()
    router.push('/admin/login')
  }

  return (
    <>
      <HamburgerButton onToggle={() => setMobileOpen(!mobileOpen)} />

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={closeMobile} />
      )}

      <aside className={cn(
        'bg-sidebar text-sidebar-foreground flex flex-col shrink-0 transition-all duration-200 z-40',
        'hidden lg:flex lg:w-60',
        mobileOpen && 'fixed inset-y-0 left-0 flex w-60'
      )}>
        <div className="p-6">
          <h2 className="text-lg font-bold tracking-tight text-white">OhMyClient</h2>
          <p className="text-xs text-sidebar-foreground/50 mt-1">{t('title')}</p>
        </div>
        <nav className="flex-1 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              isActive={pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href))}
              onClick={closeMobile}
            />
          ))}
        </nav>
        <div className="p-3">
          <button
            onClick={handleLogout}
            className="w-full flex items-center px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white transition-colors"
          >
            {t('logout')}
          </button>
        </div>
      </aside>
    </>
  )
}
