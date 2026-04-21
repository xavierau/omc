'use client'

import { useTranslations } from 'next-intl'

interface PlaceholderToolbarProps {
  placeholders: readonly string[]
  onInsert: (token: string) => void
  translationNamespace?: 'welcomeSetup' | 'campaigns'
}

export function PlaceholderToolbar({
  placeholders,
  onInsert,
  translationNamespace = 'welcomeSetup',
}: PlaceholderToolbarProps) {
  const t = useTranslations(translationNamespace)
  if (placeholders.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {placeholders.map((token) => (
        <button
          key={token}
          type="button"
          onClick={() => onInsert(token)}
          className="rounded-full border border-input bg-background px-2.5 py-0.5 text-xs font-mono hover:bg-accent hover:text-accent-foreground"
        >
          {t('insertPlaceholder')} {token}
        </button>
      ))}
    </div>
  )
}
