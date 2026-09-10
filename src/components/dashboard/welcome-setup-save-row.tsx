'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

interface SaveRowProps {
  dirty: boolean
  saving: boolean
  status: SaveStatus
  onSave: () => void
}

export function SaveRow({ dirty, saving, status, onSave }: SaveRowProps) {
  const t = useTranslations('welcomeSetup')
  const tc = useTranslations('common')
  return (
    <div className="flex items-center justify-end gap-3 pt-2">
      <StatusText
        status={status}
        savedLabel={t('savedToast')}
        failedLabel={t('saveFailedToast')}
      />
      <Button type="button" onClick={onSave} disabled={!dirty || saving}>
        {saving ? tc('saving') : t('saveButton')}
      </Button>
    </div>
  )
}

function StatusText({
  status,
  savedLabel,
  failedLabel,
}: {
  status: SaveStatus
  savedLabel: string
  failedLabel: string
}) {
  if (status.kind === 'idle') return null
  const isError = status.kind === 'error'
  const label = isError ? `${failedLabel}: ${status.message}` : savedLabel
  return (
    <span
      role="status"
      aria-live="polite"
      className={`text-sm ${isError ? 'text-destructive' : 'text-green-700 dark:text-green-400'}`}
    >
      {label}
    </span>
  )
}
