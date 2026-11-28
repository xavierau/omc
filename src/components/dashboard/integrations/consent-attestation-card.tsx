'use client'

// INT-001 WI-9 — per-integration consent attestation text + owner
// acknowledgement (OD-13, security-architect amendment: plan.md line 23).
// Present (non-empty text + acknowledged) -> partner-asserted consent is
// graded `strong` and copied into `consent_text_shown` at create time;
// absent -> graded `weak`. Grading itself is server-side (WI-1/WI-3); this
// card only explains the rule and saves the two fields via the shared
// settings PATCH.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { patchIntegrationSettings, type IntegrationSettingsView } from '@/hooks/integrations-client'
import { settingsErrorMessageKey } from '@/components/dashboard/integrations/settings-error-messages'

export type AttestationGrade = 'strong' | 'weak'

/** Pure — mirrors OD-13's rule for the live (possibly unsaved) form values,
 * shown as a hint; the actual grade applied to a member is decided
 * server-side at create time from the SAVED row, not this preview. */
export function attestationGrade(text: string, ack: boolean): AttestationGrade {
  return text.trim().length > 0 && ack ? 'strong' : 'weak'
}

export interface ConsentAttestationViewProps {
  text: string
  ack: boolean
  onTextChange: (value: string) => void
  onAckChange: (value: boolean) => void
  saving: boolean
  saved: boolean
  errorCode: string | null
  onSave: () => void
}

/** Pure/props-driven. */
export function ConsentAttestationView({
  text,
  ack,
  onTextChange,
  onAckChange,
  saving,
  saved,
  errorCode,
  onSave,
}: ConsentAttestationViewProps) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')
  const grade = attestationGrade(text, ack)

  return (
    <Card data-testid="consent-attestation-card">
      <CardHeader>
        <CardTitle>{t('attestationCardTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('attestationCardDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">{t('attestationTextLabel')}</label>
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            rows={3}
            placeholder={t('attestationTextPlaceholder')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            data-testid="attestation-text"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => onAckChange(e.target.checked)}
            data-testid="attestation-ack"
          />
          {t('attestationAckLabel')}
        </label>
        <p className="text-xs text-muted-foreground" data-testid="attestation-grade-hint">
          {grade === 'strong' ? t('attestationGradeStrong') : t('attestationGradeWeak')}
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={onSave} disabled={saving} data-testid="attestation-save">
            {saving ? tc('saving') : tc('save')}
          </Button>
          {saved && !errorCode && (
            <p className="text-xs text-muted-foreground" data-testid="attestation-saved">{t('savedIndicator')}</p>
          )}
        </div>
        {errorCode && (
          <p className="text-xs text-destructive" data-testid="attestation-error">
            {t(settingsErrorMessageKey(errorCode))}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ConsentAttestationCard({
  integrationId,
  initialSettings,
}: {
  integrationId: string
  initialSettings: IntegrationSettingsView
}) {
  const [text, setText] = useState(initialSettings.consentAttestationText ?? '')
  const [ack, setAck] = useState(initialSettings.consentAttestationAckAt !== null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const onTextChange = (value: string) => {
    setText(value)
    setSaved(false)
    setErrorCode(null)
  }

  const onAckChange = (value: boolean) => {
    setAck(value)
    setSaved(false)
    setErrorCode(null)
  }

  const onSave = async () => {
    setSaving(true)
    setErrorCode(null)
    setSaved(false)
    const result = await patchIntegrationSettings(integrationId, {
      consentAttestationText: text.trim().length > 0 ? text : null,
      consentAttestationAck: ack,
    })
    setSaving(false)
    if (!result.ok) {
      setErrorCode(result.error)
      return
    }
    setSaved(true)
  }

  return (
    <ConsentAttestationView
      text={text}
      ack={ack}
      onTextChange={onTextChange}
      onAckChange={onAckChange}
      saving={saving}
      saved={saved}
      errorCode={errorCode}
      onSave={onSave}
    />
  )
}
