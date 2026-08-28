'use client'

import { useTranslations } from 'next-intl'
import { STEP_COUNT } from './types'

const STEP_KEYS = [
  'stepTenantInfo',
  'stepWhatsapp',
  'stepTest',
  'stepReview',
] as const

export function StepIndicator({ current }: { current: number }) {
  const t = useTranslations('onboarding')

  return (
    <div className="flex items-center gap-2">
      {STEP_KEYS.map((key, i) => {
        const step = i + 1
        const isActive = step === current
        const isDone = step < current
        return (
          <div key={key} className="flex items-center gap-2">
            {i > 0 && (
              <div className={`h-px w-6 ${isDone ? 'bg-primary' : 'bg-border'}`} />
            )}
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : isDone
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {isDone ? '\u2713' : step}
              </span>
              <span
                className={`text-xs ${
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {t(key)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
