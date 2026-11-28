'use client'

/**
 * BOOK-009 S1.1 / AC-3: "複製到…" copies a day's periods to all days, Mon–Fri
 * or Sat–Sun. The copy changes rows only; Save stores it (A2 mockup note).
 */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Copy } from 'lucide-react'
import type { CopyTarget } from './hours-model'

const TARGETS: { target: CopyTarget; key: 'copyAll' | 'copyWeekdays' | 'copyWeekend' }[] = [
  { target: 'all', key: 'copyAll' },
  { target: 'weekdays', key: 'copyWeekdays' },
  { target: 'weekend', key: 'copyWeekend' },
]

export function CopyDayMenu({ dayLabel, testId, onCopy }: { dayLabel: string; testId: string; onCopy: (target: CopyTarget) => void }) {
  const t = useTranslations('bookingSettings.bookingHours')
  const [open, setOpen] = useState(false)
  return (
    <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('copyLabel', { day: dayLabel })}
        onClick={() => setOpen((o) => !o)} data-testid={`${testId}-copy`}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <Copy className="size-3.5" aria-hidden />{t('copy')}
      </button>
      {open ? (
        <div role="menu" data-testid={`${testId}-copy-menu`} className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {TARGETS.map(({ target, key }) => (
            <button key={target} type="button" role="menuitem" data-testid={`${testId}-copy-${target}`}
              onClick={() => { onCopy(target); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
              <Copy className="size-4 text-muted-foreground" aria-hidden />{t(key)}
            </button>
          ))}
          <p className="px-2 pb-1 pt-1 text-xs text-muted-foreground">{t('copyNote')}</p>
        </div>
      ) : null}
    </div>
  )
}
