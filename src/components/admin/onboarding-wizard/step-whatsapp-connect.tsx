'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { StepProps } from './types'

interface Props extends StepProps {
  onValidated: (valid: boolean) => void
  isValidated: boolean
}

export function StepWhatsappConnect({
  data, onChange, onValidated, isValidated,
}: Props) {
  const t = useTranslations('onboarding')
  const ta = useTranslations('admin')
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wabaId, setWabaId] = useState<string | null>(
    data.metaBusinessAccountId || null
  )

  async function handleValidate() {
    setIsValidating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/tenants/validate-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kapsoPhoneNumberId: data.kapsoPhoneNumberId }),
      })
      const body = await res.json()
      if (body.valid) {
        setWabaId(body.wabaId)
        onChange({ metaBusinessAccountId: body.wabaId })
        onValidated(true)
      } else {
        setError(body.error ?? t('validationFailed'))
        onValidated(false)
      }
    } catch {
      setError(t('validationFailed'))
      onValidated(false)
    } finally {
      setIsValidating(false)
    }
  }

  function handleInputChange(value: string) {
    onChange({ kapsoPhoneNumberId: value })
    onValidated(false)
    setWabaId(null)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('whatsappTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('whatsappDescription')}</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          {ta('kapsoPhoneNumberId')}
        </label>
        <div className="flex gap-2">
          <Input
            value={data.kapsoPhoneNumberId}
            onChange={e => handleInputChange(e.target.value)}
          />
          <Button
            type="button"
            disabled={!data.kapsoPhoneNumberId.trim() || isValidating}
            onClick={handleValidate}
          >
            {isValidating ? t('validating') : t('validate')}
          </Button>
        </div>
      </div>
      {isValidated && wabaId && (
        <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          <span className="text-green-600">{'\u2713'}</span>
          <span>{t('validationSuccess')} {t('resolvedWabaId', { wabaId })}</span>
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
