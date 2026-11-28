'use client'

// INT-001 WI-9 — US-8: "Welcome message for members created by this
// integration". Launch UI exposes exactly two choices (OD-1): Off (`null`)
// and Tenant default (`'default'`). A specific template id can already be
// set via the partner API (US-4 model+API ship at launch; the picker is
// post-launch) — when it is, the control shows it read-only with Off as the
// only other choice (spec US-8), rather than letting the dashboard silently
// clobber an API-set value with a picker it doesn't have yet.
//
// `resolvedTemplate` only reflects the CURRENTLY SAVED `newJoinTemplateId`
// (GET/PATCH re-resolve it fresh, but never for an unsaved radio pick —
// there's no preview endpoint). So the "Sends <name> (<category>)..." copy
// is shown only once the displayed choice matches the last successfully
// saved one; an unsaved pick toward 'default' shows a neutral
// "save to see what this sends" line instead of guessing.

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  patchIntegrationSettings,
  type IntegrationSettingsView,
  type ResolvedTemplateView,
  type TemplateCategory,
} from '@/hooks/integrations-client'
import { settingsErrorMessageKey } from '@/components/dashboard/integrations/settings-error-messages'

export type WelcomeChoice = 'off' | 'default'

export type WelcomeHelperState =
  | { kind: 'off' }
  | { kind: 'defaultPending' }
  | { kind: 'defaultResolved'; name: string; category: TemplateCategory; marketingNote: boolean }

/** Pure: what the helper line under the radio group should say, given the
 * live (possibly unsaved) choice vs. the last value actually persisted. */
export function welcomeHelperState(
  choice: WelcomeChoice,
  lastSavedChoice: WelcomeChoice,
  resolvedTemplate: ResolvedTemplateView | null
): WelcomeHelperState {
  if (choice === 'off') return { kind: 'off' }
  if (choice !== lastSavedChoice || !resolvedTemplate) return { kind: 'defaultPending' }
  return {
    kind: 'defaultResolved',
    name: resolvedTemplate.name,
    category: resolvedTemplate.category,
    marketingNote: resolvedTemplate.category === 'MARKETING',
  }
}

export function initialWelcomeChoice(newJoinTemplateId: string | null): WelcomeChoice {
  return newJoinTemplateId === 'default' ? 'default' : 'off'
}

export function isLockedSpecific(newJoinTemplateId: string | null): boolean {
  return newJoinTemplateId !== null && newJoinTemplateId !== 'default'
}

export interface WelcomeTemplateViewProps {
  lockedSpecific: boolean
  specificName: string | null
  specificCategory: TemplateCategory | null
  choice: WelcomeChoice
  lastSavedChoice: WelcomeChoice
  resolvedTemplate: ResolvedTemplateView | null
  onChoiceChange: (choice: WelcomeChoice) => void
  saving: boolean
  saved: boolean
  warning: string | null
  errorCode: string | null
  onSave: () => void
  canSave: boolean
}

/** Pure/props-driven. */
export function WelcomeTemplateView({
  lockedSpecific,
  specificName,
  specificCategory,
  choice,
  lastSavedChoice,
  resolvedTemplate,
  onChoiceChange,
  saving,
  saved,
  warning,
  errorCode,
  onSave,
  canSave,
}: WelcomeTemplateViewProps) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')
  const helper = welcomeHelperState(choice, lastSavedChoice, resolvedTemplate)

  return (
    <Card data-testid="welcome-template-card">
      <CardHeader>
        <CardTitle>{t('welcomeCardTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('welcomeCardDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {lockedSpecific && (
          <div className="rounded-md border border-border p-3 space-y-1" data-testid="welcome-specific-readonly">
            <p className="text-sm font-medium text-foreground">
              {t('welcomeSpecificLabel', { name: specificName ?? t('welcomeSpecificUnknown') })}
            </p>
            {specificCategory && <p className="text-xs text-muted-foreground">{specificCategory}</p>}
          </div>
        )}

        <fieldset className="space-y-2">
          <legend className="sr-only">{t('welcomeCardTitle')}</legend>
          {!lockedSpecific && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="welcome-template-choice"
                checked={choice === 'default'}
                onChange={() => onChoiceChange('default')}
                data-testid="welcome-choice-default"
              />
              {t('welcomeChoiceDefault')}
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="welcome-template-choice"
              checked={choice === 'off'}
              onChange={() => onChoiceChange('off')}
              data-testid="welcome-choice-off"
            />
            {t('welcomeChoiceOff')}
          </label>
        </fieldset>

        {helper.kind === 'off' && (
          <p className="text-xs text-muted-foreground" data-testid="welcome-helper-off">{t('welcomeHelperOff')}</p>
        )}
        {helper.kind === 'defaultPending' && (
          <p className="text-xs text-muted-foreground" data-testid="welcome-helper-pending">{t('welcomeHelperPending')}</p>
        )}
        {helper.kind === 'defaultResolved' && (
          <div className="space-y-1" data-testid="welcome-helper-resolved">
            <p className="text-xs text-muted-foreground">
              {t('welcomeHelperDefault', { name: helper.name, category: helper.category })}
            </p>
            {helper.marketingNote && (
              <p className="text-xs text-amber-700" data-testid="welcome-marketing-note">
                {t('welcomeMarketingNote')}
              </p>
            )}
          </div>
        )}

        {warning === 'tenant_quality_paused' && (
          <p className="text-xs text-amber-700" data-testid="welcome-warning-paused">
            {t('welcomeWarningQualityPaused')}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={onSave} disabled={saving || !canSave} data-testid="welcome-save">
            {saving ? tc('saving') : tc('save')}
          </Button>
          {saved && !errorCode && (
            <p className="text-xs text-muted-foreground" data-testid="welcome-saved">{t('savedIndicator')}</p>
          )}
        </div>

        {errorCode && (
          <div className="space-y-1" data-testid="welcome-error">
            <p className="text-xs text-destructive">{t(settingsErrorMessageKey(errorCode))}</p>
            {errorCode === 'no_default_welcome_template' && (
              <Link href="/dashboard/wa-templates" className="text-xs text-primary underline" data-testid="welcome-error-link">
                {t('welcomeErrorTemplateLink')}
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function WelcomeTemplateCard({
  integrationId,
  initialSettings,
}: {
  integrationId: string
  initialSettings: IntegrationSettingsView
}) {
  const initialChoice = initialWelcomeChoice(initialSettings.newJoinTemplateId)
  const [lockedSpecific, setLockedSpecific] = useState(isLockedSpecific(initialSettings.newJoinTemplateId))
  const [specificName] = useState(initialSettings.resolvedTemplate?.name ?? null)
  const [specificCategory] = useState(initialSettings.resolvedTemplate?.category ?? null)
  const [choice, setChoice] = useState<WelcomeChoice>(initialChoice)
  const [lastSavedChoice, setLastSavedChoice] = useState<WelcomeChoice>(initialChoice)
  const [resolvedTemplate, setResolvedTemplate] = useState<ResolvedTemplateView | null>(
    lockedSpecific ? null : initialSettings.resolvedTemplate
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const onChoiceChange = (next: WelcomeChoice) => {
    setChoice(next)
    setSaved(false)
    setErrorCode(null)
    setWarning(null)
  }

  const canSave = !lockedSpecific || choice === 'off'

  const onSave = async () => {
    setSaving(true)
    setErrorCode(null)
    setWarning(null)
    setSaved(false)
    const result = await patchIntegrationSettings(integrationId, {
      newJoinTemplateId: choice === 'off' ? null : 'default',
    })
    setSaving(false)
    if (!result.ok) {
      setErrorCode(result.error)
      setChoice(lastSavedChoice)
      return
    }
    setLastSavedChoice(choice)
    setResolvedTemplate(result.settings.resolvedTemplate)
    setLockedSpecific(false)
    setWarning(result.warnings.includes('tenant_quality_paused') ? 'tenant_quality_paused' : null)
    setSaved(true)
  }

  return (
    <WelcomeTemplateView
      lockedSpecific={lockedSpecific}
      specificName={specificName}
      specificCategory={specificCategory}
      choice={choice}
      lastSavedChoice={lastSavedChoice}
      resolvedTemplate={resolvedTemplate}
      onChoiceChange={onChoiceChange}
      saving={saving}
      saved={saved}
      warning={warning}
      errorCode={errorCode}
      onSave={onSave}
      canSave={canSave}
    />
  )
}
