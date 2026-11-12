'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export type ScanMode = 'redeem' | 'stamp'

interface ScanModeToggleProps {
  mode: ScanMode
  onChange: (mode: ScanMode) => void
}

// Segmented control: Redeem | Give Stamp. Default 'redeem' (decided by the page).
// The toggle only picks the endpoint; redeem-mode routing is left UNCHANGED.
export function ScanModeToggle({ mode, onChange }: ScanModeToggleProps) {
  const t = useTranslations('scan')
  return (
    <div
      role="tablist"
      aria-label={t('heading')}
      className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
    >
      <ModeButton active={mode === 'redeem'} label={t('modeRedeem')} onClick={() => onChange('redeem')} />
      <ModeButton active={mode === 'stamp'} label={t('modeStamp')} onClick={() => onChange('stamp')} />
    </div>
  )
}

function ModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-active={active}
      onClick={onClick}
      className={cn(
        'h-9 rounded-md text-sm font-medium transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}
