'use client'

import { useTranslations } from 'next-intl'
import {
  ONBOARDING_PHASES,
  type OnboardingPhase,
} from '@/domain/value-objects/onboarding-phase'
import { phaseStepStatus } from '@/components/admin/onboarding/onboarding-view-helpers'
import type { OnboardingStateView } from '@/hooks/use-admin-tenant-onboarding'

interface OnboardingPhaseIndicatorProps {
  view: OnboardingStateView
}

const STATUS_CLASS: Record<'done' | 'current' | 'upcoming', string> = {
  done: 'bg-emerald-500 text-white',
  current: 'bg-primary text-primary-foreground ring-2 ring-primary/30',
  upcoming: 'bg-muted text-muted-foreground',
}

export function OnboardingPhaseIndicator({ view }: OnboardingPhaseIndicatorProps) {
  const t = useTranslations('admin.onboarding')
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {ONBOARDING_PHASES.map((phase: OnboardingPhase, idx) => {
        const status = phaseStepStatus(view, phase)
        return (
          <li
            key={phase}
            data-phase-step={phase}
            data-status={status}
            className="flex items-center gap-2"
          >
            <span
              className={`inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold ${STATUS_CLASS[status]}`}
            >
              {idx + 1}
            </span>
            <span
              className={
                status === 'current'
                  ? 'text-sm font-medium text-foreground'
                  : 'text-sm text-muted-foreground'
              }
            >
              {t(`phase.${phase}`)}
            </span>
            {idx < ONBOARDING_PHASES.length - 1 && (
              <span className="mx-1 hidden h-px w-4 bg-border sm:block" />
            )}
          </li>
        )
      })}
    </ol>
  )
}
