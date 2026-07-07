'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { isValidPhoneE164 } from '@/infrastructure/validation/validators'

interface Props {
  initialRedirectNumber: string | null
  initialRedirectLabel: string
}

export function ContactRedirectSection({
  initialRedirectNumber,
  initialRedirectLabel,
}: Props) {
  const t = useTranslations('settings')
  const [number, setNumber] = useState(initialRedirectNumber ?? '')
  const [label, setLabel] = useState(initialRedirectLabel)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedNumber = number.trim()
  const numberInvalid = trimmedNumber !== '' && !isValidPhoneE164(trimmedNumber)

  async function save() {
    if (numberInvalid) {
      setError(t('redirectInvalid'))
      return
    }
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/settings/contact-redirect', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirectNumber: trimmedNumber === '' ? null : trimmedNumber,
          redirectLabel: label.trim(),
        }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSaved(true)
    } catch {
      setError(t('redirectSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  function onNumberChange(value: string) {
    setNumber(value)
    setSaved(false)
    setError(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('contactRedirectTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('contactRedirectDescription')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label={t('redirectNumberLabel')}>
          <Input
            type="tel"
            value={number}
            onChange={(e) => onNumberChange(e.target.value)}
            placeholder={t('redirectNumberPlaceholder')}
            aria-invalid={numberInvalid}
          />
          {numberInvalid && (
            <p className="text-xs text-destructive mt-1">{t('redirectInvalid')}</p>
          )}
        </Field>
        <Field label={t('redirectLabelLabel')}>
          <Input
            value={label}
            maxLength={20}
            onChange={(e) => {
              setLabel(e.target.value)
              setSaved(false)
            }}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || numberInvalid}>
            {saving ? t('saving') : t('save')}
          </Button>
          {saved && (
            <p className="text-xs text-muted-foreground">{t('redirectSaved')}</p>
          )}
          {error && !numberInvalid && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground mb-1 block">
        {label}
      </label>
      {children}
    </div>
  )
}
