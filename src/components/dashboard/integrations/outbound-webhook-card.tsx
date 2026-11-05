'use client'

// INT-001 WI-9 — US-7/US-9: outbound webhook URL + events + PII ack +
// enabled toggle (one PATCH, `update-integration-settings.ts`'s merged
// invariant check), the partner-minted signing secret (OD-9: pasted by the
// owner, never generated here, shown once at save and never again — a
// SEPARATE PUT from the settings PATCH, matching the two distinct spec rows
// "Save URL" vs "Save / replace outbound secret"), and "Send test event"
// (WI-6's `sendTestEvent`, 202 + deliveryId). The delivery's live status
// (queued -> delivered/failed) and the paused-banner/streak/Resume flow are
// WI-10's `delivery-log-table.tsx` / `paused-banner.tsx` — this card only
// triggers the test and reports the immediate accept/reject; see the
// `data-testid="outbound-test-extension-point"` note below for where WI-10
// mounts the live row.
//
// `outboundEnabled` can only be saved true when url+secret+piiAck are ALL
// present (WI-1's frozen `IntegrationSettings.fromProps` invariant) — rather
// than let an admin submit an invalid combination and read the resulting
// `pii_ack_required` 422, the Enabled checkbox is disabled client-side until
// the prerequisites are met (`canEnableOutbound`), matching spec's own copy
// ("stays Disabled with inline 'Acknowledge to enable'"). The 422 is still
// mapped and rendered defensively (`errorCode`) in case of a stale-state race.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  patchIntegrationSettings,
  putOutboundSecret,
  sendTestEventRequest,
  type IntegrationSettingsView,
  type OutboundEventName,
  type OutboundStatus,
} from '@/hooks/integrations-client'
import { settingsErrorMessageKey } from '@/components/dashboard/integrations/settings-error-messages'

const ALL_EVENTS: OutboundEventName[] = ['member.created', 'member.updated']

/** Pure — the invariant `IntegrationSettings.fromProps` enforces server-side
 * (WI-1), mirrored here only to keep the checkbox from offering an
 * combination the save would reject. */
export function canEnableOutbound(url: string, hasSecret: boolean, piiAck: boolean): boolean {
  return url.trim().length > 0 && hasSecret && piiAck
}

export function outboundStatusLabelKey(status: OutboundStatus): string {
  if (status === 'paused_auto') return 'statusPausedAuto'
  if (status === 'paused_manual') return 'statusPausedManual'
  return 'statusActive'
}

export function defaultOutboundEvents(saved: OutboundEventName[]): OutboundEventName[] {
  return saved.length > 0 ? saved : ['member.created']
}

export interface OutboundSettingsFormProps {
  url: string
  onUrlChange: (value: string) => void
  events: OutboundEventName[]
  onToggleEvent: (event: OutboundEventName, checked: boolean) => void
  piiAck: boolean
  onPiiAckChange: (value: boolean) => void
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  canEnable: boolean
  status: OutboundStatus
  saving: boolean
  saved: boolean
  errorCode: string | null
  onSave: () => void
}

export interface OutboundSecretFormProps {
  secretLast4: string | null
  secretInput: string
  onSecretInputChange: (value: string) => void
  state: 'idle' | 'confirmingSwap' | 'saving'
  onSaveClick: () => void
  onConfirm: () => void
  onCancel: () => void
  error: string | null
  saved: boolean
}

export interface OutboundTestEventProps {
  state: 'idle' | 'sending' | 'sent' | 'error'
  deliveryId: string | null
  errorCode: string | null
  onSend: () => void
  disabled: boolean
  /** INT-001 WI-10: the extension point this file's header comment
   * documents (`outbound-test-extension-point`). Optional so this view
   * still renders correctly if a future caller doesn't wire it. Fires the
   * delivery id the test event created so the caller can switch to the
   * Delivery log tab and highlight that row (`delivery-log-table.tsx`'s
   * `highlightDeliveryId`). */
  onViewDelivery?: (deliveryId: string) => void
}

/** Pure/props-driven. */
export function OutboundWebhookView({
  form,
  secret,
  test,
}: {
  form: OutboundSettingsFormProps
  secret: OutboundSecretFormProps
  test: OutboundTestEventProps
}) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')

  return (
    <Card data-testid="outbound-webhook-card">
      <CardHeader>
        <CardTitle>{t('outboundCardTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('outboundCardDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">{t('outboundUrlLabel')}</label>
            <div className="flex items-center gap-2">
              <Input
                value={form.url}
                onChange={(e) => form.onUrlChange(e.target.value)}
                placeholder={t('outboundUrlPlaceholder')}
                data-testid="outbound-url-input"
              />
              <Badge
                variant={form.status === 'active' ? 'default' : 'secondary'}
                data-testid="outbound-status-badge"
              >
                {t(outboundStatusLabelKey(form.status))}
              </Badge>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground mb-1">{t('outboundEventsLabel')}</legend>
            {ALL_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.events.includes(event)}
                  onChange={(e) => form.onToggleEvent(event, e.target.checked)}
                  data-testid={`outbound-event-${event}`}
                />
                {event}
              </label>
            ))}
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.piiAck}
              onChange={(e) => form.onPiiAckChange(e.target.checked)}
              data-testid="outbound-pii-ack"
            />
            {t('outboundPiiAckLabel')}
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={!form.canEnable}
              onChange={(e) => form.onEnabledChange(e.target.checked)}
              data-testid="outbound-enabled"
            />
            {t('outboundEnabledLabel')}
          </label>
          {!form.canEnable && (
            <p className="text-xs text-muted-foreground" data-testid="outbound-enable-prereq-hint">
              {t('outboundEnablePrereqHint')}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={form.onSave} disabled={form.saving} data-testid="outbound-save">
              {form.saving ? tc('saving') : tc('save')}
            </Button>
            {form.saved && !form.errorCode && (
              <p className="text-xs text-muted-foreground" data-testid="outbound-saved">{t('savedIndicator')}</p>
            )}
          </div>
          {form.errorCode && (
            <p className="text-xs text-destructive" data-testid="outbound-save-error">
              {t(settingsErrorMessageKey(form.errorCode))}
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <label className="text-sm font-medium text-foreground mb-1 block">{t('outboundSecretLabel')}</label>
          <p className="text-xs text-muted-foreground" data-testid="outbound-secret-status">
            {secret.secretLast4 ? t('secretMasked', { last4: secret.secretLast4 }) : t('secretNotSet')}
          </p>
          <Input
            type="password"
            value={secret.secretInput}
            onChange={(e) => secret.onSecretInputChange(e.target.value)}
            placeholder={t('outboundSecretPlaceholder')}
            data-testid="outbound-secret-input"
          />
          {secret.state === 'confirmingSwap' && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="outbound-secret-swap-warning">
              <p className="text-xs text-amber-800">{t('outboundSecretSwapWarning')}</p>
              <div className="flex gap-2">
                <Button onClick={secret.onConfirm} data-testid="outbound-secret-confirm">
                  {t('outboundSecretConfirmButton')}
                </Button>
                <Button variant="outline" onClick={secret.onCancel}>{tc('cancel')}</Button>
              </div>
            </div>
          )}
          {secret.state === 'idle' && (
            <Button variant="outline" onClick={secret.onSaveClick} data-testid="outbound-secret-save">
              {tc('save')}
            </Button>
          )}
          {secret.state === 'saving' && (
            <p className="text-sm text-muted-foreground" data-testid="outbound-secret-saving">{tc('saving')}</p>
          )}
          {secret.saved && (
            <p className="text-xs text-muted-foreground" data-testid="outbound-secret-saved">{t('outboundSecretSaved')}</p>
          )}
          {secret.error && (
            <p className="text-xs text-destructive" data-testid="outbound-secret-error">
              {t(settingsErrorMessageKey(secret.error))}
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={test.onSend}
            disabled={test.disabled || test.state === 'sending'}
            data-testid="outbound-send-test"
          >
            {test.state === 'sending' ? t('outboundTestSending') : t('outboundTestSend')}
          </Button>
          {test.state === 'sent' && (
            <p className="text-xs text-muted-foreground" data-testid="outbound-test-sent">
              {t('outboundTestQueued', { id: test.deliveryId ?? '' })}
            </p>
          )}
          {test.state === 'error' && test.errorCode && (
            <p className="text-xs text-destructive" data-testid="outbound-test-error">
              {t(settingsErrorMessageKey(test.errorCode))}
            </p>
          )}
          {/* WI-10 extension point: on a successful test event, a link into
              the Delivery log tab (which highlights and, while it's the
              highlighted row, live-polls this delivery every 2s for 30s --
              see delivery-log-table.tsx's highlightDeliveryId). */}
          <div data-testid="outbound-test-extension-point">
            {test.state === 'sent' && test.deliveryId && test.onViewDelivery && (
              <Button
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => test.onViewDelivery!(test.deliveryId!)}
                data-testid="outbound-test-view-in-log"
              >
                {t('outboundTestViewInLog')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function OutboundWebhookCard({
  integrationId,
  initialSettings,
  onViewDelivery,
}: {
  integrationId: string
  initialSettings: IntegrationSettingsView
  onViewDelivery?: (deliveryId: string) => void
}) {
  const [url, setUrl] = useState(initialSettings.outboundUrl ?? '')
  const [events, setEvents] = useState<OutboundEventName[]>(defaultOutboundEvents(initialSettings.outboundEvents))
  const [piiAck, setPiiAck] = useState(initialSettings.outboundPiiAckAt !== null)
  const [enabled, setEnabled] = useState(initialSettings.outboundEnabled)
  const [status, setStatus] = useState(initialSettings.outboundStatus)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const [secretLast4, setSecretLast4] = useState(initialSettings.outboundSecretLast4)
  const [secretInput, setSecretInput] = useState('')
  const [secretState, setSecretState] = useState<'idle' | 'confirmingSwap' | 'saving'>('idle')
  const [secretError, setSecretError] = useState<string | null>(null)
  const [secretSaved, setSecretSaved] = useState(false)

  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testDeliveryId, setTestDeliveryId] = useState<string | null>(null)
  const [testErrorCode, setTestErrorCode] = useState<string | null>(null)

  const canEnable = canEnableOutbound(url, secretLast4 !== null, piiAck)

  const onUrlChange = (value: string) => {
    setUrl(value)
    setSaved(false)
    setErrorCode(null)
  }

  const onToggleEvent = (event: OutboundEventName, checked: boolean) => {
    setEvents((prev) => (checked ? [...prev.filter((e) => e !== event), event] : prev.filter((e) => e !== event)))
    setSaved(false)
    setErrorCode(null)
  }

  const onPiiAckChange = (value: boolean) => {
    setPiiAck(value)
    setSaved(false)
    setErrorCode(null)
  }

  const onEnabledChange = (value: boolean) => {
    setEnabled(value)
    setSaved(false)
    setErrorCode(null)
  }

  const onSave = async () => {
    setSaving(true)
    setErrorCode(null)
    setSaved(false)
    const result = await patchIntegrationSettings(integrationId, {
      outboundUrl: url,
      outboundEvents: events,
      outboundPiiAck: piiAck,
      outboundEnabled: enabled,
    })
    setSaving(false)
    if (!result.ok) {
      setErrorCode(result.error)
      return
    }
    setStatus(result.settings.outboundStatus)
    setSaved(true)
  }

  const doSaveSecret = async () => {
    setSecretState('saving')
    setSecretSaved(false)
    const result = await putOutboundSecret(integrationId, secretInput)
    if (!result.ok) {
      setSecretError(result.error)
      setSecretState('idle')
      return
    }
    setSecretLast4(result.last4)
    setSecretInput('')
    setSecretState('idle')
    setSecretSaved(true)
  }

  const onSecretInputChange = (value: string) => {
    setSecretInput(value)
    setSecretSaved(false)
    setSecretError(null)
  }

  const onSecretSaveClick = () => {
    setSecretError(null)
    if (secretLast4 !== null) {
      setSecretState('confirmingSwap')
      return
    }
    doSaveSecret()
  }

  const onSecretConfirm = () => doSaveSecret()
  const onSecretCancel = () => setSecretState('idle')

  const onSendTest = async () => {
    setTestState('sending')
    setTestErrorCode(null)
    const result = await sendTestEventRequest(integrationId)
    if (!result.ok) {
      setTestErrorCode(result.error)
      setTestState('error')
      return
    }
    setTestDeliveryId(result.deliveryId)
    setTestState('sent')
  }

  return (
    <OutboundWebhookView
      form={{
        url,
        onUrlChange,
        events,
        onToggleEvent,
        piiAck,
        onPiiAckChange,
        enabled,
        onEnabledChange,
        canEnable,
        status,
        saving,
        saved,
        errorCode,
        onSave,
      }}
      secret={{
        secretLast4,
        secretInput,
        onSecretInputChange,
        state: secretState,
        onSaveClick: onSecretSaveClick,
        onConfirm: onSecretConfirm,
        onCancel: onSecretCancel,
        error: secretError,
        saved: secretSaved,
      }}
      test={{
        state: testState,
        deliveryId: testDeliveryId,
        errorCode: testErrorCode,
        onSend: onSendTest,
        disabled: !url || !enabled,
        onViewDelivery,
      }}
    />
  )
}
