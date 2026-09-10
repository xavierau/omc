'use client'

import { useTranslations } from 'next-intl'
import { STEPS, type StepKey } from './wizard-helpers'

export function WizardStepper({ current }: { current: StepKey }) {
  const t = useTranslations('importWizard')
  return (
    <ol className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
      {STEPS.map((s, i) => (
        <li
          key={s}
          data-step-pill={s}
          className={s === current ? 'font-semibold text-foreground' : undefined}
        >
          {i + 1}. {t(`steps.${s}`)}
        </li>
      ))}
    </ol>
  )
}
