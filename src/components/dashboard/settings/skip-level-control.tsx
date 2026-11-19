'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { SkipLevel } from './campaign-settings-form'

const LEVELS: Array<{ level: SkipLevel; key: 'skipRed' | 'skipRedYellow'; testId: string }> = [
  { level: 'red', key: 'skipRed', testId: 'settings-campaigns-skip-level-red' },
  { level: 'red_yellow', key: 'skipRedYellow', testId: 'settings-campaigns-skip-level-red-yellow' },
]

/** Segmented control: Red only (Recommended) | Red and Yellow. */
export function SkipLevelControl(props: { value: SkipLevel; onChange: (l: SkipLevel) => void; disabled?: boolean }) {
  const t = useTranslations('campaignSettings')
  return (
    <div role="radiogroup" aria-label={t('skipWhich')} className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {LEVELS.map(({ level, key, testId }) => {
        const selected = props.value === level
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={props.disabled}
            onClick={() => props.onChange(level)}
            data-testid={testId}
            className={cn(
              'flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
              selected ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(key)}
            {level === 'red' ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t('recommended')}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
