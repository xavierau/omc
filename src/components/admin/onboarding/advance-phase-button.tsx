'use client'

import { useTranslations } from 'next-intl'
import type { BlockedReason } from '@/hooks/use-admin-tenant-onboarding'
import { blockedReasonI18nKey } from '@/components/admin/onboarding/onboarding-view-helpers'

interface AdvancePhaseButtonProps {
  canAdvance: boolean
  blockedReasons: readonly BlockedReason[]
  onAdvance: () => void
}

export function AdvancePhaseButton({
  canAdvance,
  blockedReasons,
  onAdvance,
}: AdvancePhaseButtonProps) {
  const t = useTranslations('admin.onboarding')
  return (
    <div className="relative inline-flex group/advance">
      <button
        type="button"
        onClick={onAdvance}
        disabled={!canAdvance}
        className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {t('advance.button')}
      </button>
      {!canAdvance && blockedReasons.length > 0 && (
        <ul
          role="tooltip"
          className="invisible absolute left-0 top-full z-10 mt-2 w-max max-w-xs rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground opacity-0 shadow-md transition group-hover/advance:visible group-hover/advance:opacity-100"
        >
          {blockedReasons.map((reason) => (
            <li key={reason} data-reason={reason} className="leading-snug">
              {t(blockedReasonI18nKey(reason))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
