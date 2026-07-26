'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { isValidPhoneE164 } from '@/infrastructure/validation/validators'
import { ContactFormSettings, type ContactFormSettingsProps } from '@/components/dashboard/contact-form-settings'
import type { ContactMode, ResolvedContactConfig } from '@/domain/services/contact-config'
import {
  buildContactConfigPayload,
  canSaveContactConfig,
  isContactEmailInvalid,
} from '@/components/dashboard/contact-config-payload'

/** Both `/contact-redirect` and `/contact-config` PATCH routes return `{ error: string }` on failure. */
export async function firstErrorDetail(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json()
    const error = (body as { error?: unknown })?.error
    return typeof error === 'string' ? error : null
  } catch {
    return null
  }
}

interface Props {
  initialRedirectNumber: string | null
  initialRedirectLabel: string
  initialContactConfig: ResolvedContactConfig
}

export function ContactRedirectSection({
  initialRedirectNumber,
  initialRedirectLabel,
  initialContactConfig,
}: Props) {
  const t = useTranslations('settings')
  const [number, setNumber] = useState(initialRedirectNumber ?? '')
  const [label, setLabel] = useState(initialRedirectLabel)
  const [mode, setMode] = useState<ContactMode>(initialContactConfig.mode)
  const [notificationEmail, setNotificationEmail] = useState(initialContactConfig.notificationEmail ?? '')
  const [topics, setTopics] = useState<string[]>(initialContactConfig.topics)
  const [ackText, setAckText] = useState(initialContactConfig.ackText ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedNumber = number.trim()
  const numberInvalid = trimmedNumber !== '' && !isValidPhoneE164(trimmedNumber)
  const emailInvalid = isContactEmailInvalid(mode, notificationEmail)

  function onModeChange(next: ContactMode) {
    setMode(next)
    setSaved(false)
    setError(null)
  }

  function onTopicChange(index: number, value: string) {
    setTopics((prev) => prev.map((topic, i) => (i === index ? value : topic)))
    setSaved(false)
  }

  function onNotificationEmailChange(value: string) {
    setNotificationEmail(value)
    setSaved(false)
    setError(null)
  }

  function onAckTextChange(value: string) {
    setAckText(value)
    setSaved(false)
  }

  async function save() {
    if (numberInvalid) {
      setError(t('redirectInvalid'))
      return
    }
    if (!canSaveContactConfig({ mode, notificationEmail, topics, ackText })) {
      setError(t('contactConfigInvalid'))
      return
    }
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const [redirectRes, contactConfigRes] = await Promise.all([
        fetch('/api/dashboard/settings/contact-redirect', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            redirectNumber: trimmedNumber === '' ? null : trimmedNumber,
            redirectLabel: label.trim(),
          }),
        }),
        fetch('/api/dashboard/settings/contact-config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildContactConfigPayload({ mode, notificationEmail, topics, ackText })),
        }),
      ])
      if (!redirectRes.ok || !contactConfigRes.ok) {
        // Surface the server's actual reason (e.g. "topics must be exactly 5
        // unique…") instead of a generic message, so a 400 on one of the two
        // parallel PATCHes tells the admin what to fix rather than just that
        // something failed.
        const detail = await firstErrorDetail(!contactConfigRes.ok ? contactConfigRes : redirectRes)
        throw new Error(detail ?? undefined)
      }
      setSaved(true)
    } catch (err) {
      const detail = err instanceof Error ? err.message : ''
      setError(detail ? t('contactConfigSaveFailedDetail', { error: detail }) : t('redirectSaveFailed'))
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
        <ContactSettingsPanel
          mode={mode}
          onModeChange={onModeChange}
          formSettingsProps={{
            notificationEmail,
            onNotificationEmailChange,
            emailInvalid,
            topics,
            onTopicChange,
            ackText,
            onAckTextChange,
          }}
        />
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || numberInvalid || emailInvalid}>
            {saving ? t('saving') : t('save')}
          </Button>
          {saved && (
            <p className="text-xs text-muted-foreground">{t('redirectSaved')}</p>
          )}
          {error && !numberInvalid && !emailInvalid && (
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

interface ContactSettingsPanelProps {
  mode: ContactMode
  onModeChange: (mode: ContactMode) => void
  formSettingsProps: ContactFormSettingsProps
}

/** Mode radio + the form-mode fields, shown only when mode is 'form'. Pure/props-driven. */
export function ContactSettingsPanel({ mode, onModeChange, formSettingsProps }: ContactSettingsPanelProps) {
  const t = useTranslations('settings')
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground mb-1">{t('contactModeLabel')}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="contact-mode"
            checked={mode === 'redirect'}
            onChange={() => onModeChange('redirect')}
          />
          {t('contactModeRedirect')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="contact-mode"
            checked={mode === 'form'}
            onChange={() => onModeChange('form')}
          />
          {t('contactModeForm')}
        </label>
      </fieldset>
      {mode === 'form' && <ContactFormSettings {...formSettingsProps} />}
    </>
  )
}
