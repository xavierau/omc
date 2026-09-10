'use client'

import { useTranslations } from 'next-intl'
import {
  ONBOARDING_PATHS,
  isOnboardingPath,
  type OnboardingPath,
} from '@/domain/value-objects/onboarding-path'
import type { OnboardingPhase } from '@/domain/value-objects/onboarding-phase'
import { isPathSelectorDisabled } from '@/components/admin/onboarding/onboarding-view-helpers'

interface OnboardingPathSelectorProps {
  path: OnboardingPath | null
  phase: OnboardingPhase
  onChange: (path: OnboardingPath) => void
}

export function OnboardingPathSelector({
  path,
  phase,
  onChange,
}: OnboardingPathSelectorProps) {
  const t = useTranslations('admin.onboarding')
  const disabled = isPathSelectorDisabled(phase)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (isOnboardingPath(value)) onChange(value)
  }

  return (
    <fieldset
      data-path-selector
      data-disabled={disabled || undefined}
      disabled={disabled}
      className="flex flex-col gap-2"
    >
      <legend className="text-sm font-medium text-foreground">{t('path.title')}</legend>
      <div className="flex flex-wrap gap-2">
        {ONBOARDING_PATHS.map((p) => (
          <label
            key={p}
            data-path-option={p}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"
          >
            <input
              type="radio"
              name="onboarding-path"
              value={p}
              checked={path === p}
              onChange={handleChange}
              disabled={disabled}
              className="size-4 accent-primary"
            />
            <span>{t(`path.${p}`)}</span>
          </label>
        ))}
      </div>
      {disabled && (
        <p className="text-xs text-muted-foreground">{t('path.locked')}</p>
      )}
    </fieldset>
  )
}
