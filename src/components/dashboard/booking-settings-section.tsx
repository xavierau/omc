'use client'

/**
 * BOOK-001 AC-1/AC-2/AC-3: booking mode, external link and link lifetimes.
 * Rendered for admins only (setup page); the API enforces it too (R14).
 */
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { needsExternalUrl, useBookingSettings, type BookingSettingsForm } from '@/hooks/use-booking-settings'
import { useBookingSettingsSummaryState } from '@/hooks/use-booking-availability'
import { BookingTemplateStatusList } from './booking-template-status-list'
import type { BookingConfig, BookingMode } from '@/domain/value-objects/booking-config'

const MODES: BookingMode[] = ['off', 'simple', 'external']
type Update = <K extends keyof BookingSettingsForm>(key: K, value: BookingSettingsForm[K]) => void

function FieldError({ code, testId }: { code?: string; testId: string }) {
  const t = useTranslations('bookingSettings')
  return code ? <p data-testid={testId} className="text-xs text-destructive">{t(`errors.${code}`)}</p> : null
}

function LifetimeField(props: { kind: 'chat' | 'campaign'; form: BookingSettingsForm; update: Update; error?: string }) {
  const t = useTranslations('bookingSettings')
  const hoursKey = props.kind === 'chat' ? 'chatLinkTtlHours' : 'campaignLinkTtlHours'
  const noExpiryKey = props.kind === 'chat' ? 'chatLinkNoExpiry' : 'campaignLinkNoExpiry'
  return (
    <div className="space-y-1.5">
      <label htmlFor={`booking-settings-${hoursKey}`} className="text-sm font-medium">{t(`${props.kind}Lifetime`)}</label>
      <div className="flex items-center gap-3">
        <Input id={`booking-settings-${hoursKey}`} type="number" min={1} className="w-28" disabled={props.form[noExpiryKey]}
          value={props.form[hoursKey]} onChange={(e) => props.update(hoursKey, e.target.value)} data-testid={`booking-settings-${props.kind}-ttl`} />
        <span className="text-sm text-muted-foreground">{t('hours')}</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={props.form[noExpiryKey]} onChange={(e) => props.update(noExpiryKey, e.target.checked)}
            data-testid={`booking-settings-${props.kind}-no-expiry`} />
          {t('noExpiry')}
        </label>
      </div>
      <FieldError code={props.error} testId={`booking-settings-${props.kind}-ttl-error`} />
    </div>
  )
}

function ModePicker({ form, update }: { form: BookingSettingsForm; update: Update }) {
  const t = useTranslations('bookingSettings')
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{t('modeLabel')}</legend>
      {MODES.map((mode) => (
        <label key={mode} className="flex items-start gap-2 text-sm">
          <input type="radio" name="booking-mode" value={mode} checked={form.mode === mode} onChange={() => update('mode', mode)}
            className="mt-1" data-testid={`booking-settings-mode-${mode}`} />
          <span><span className="font-medium">{t(`mode.${mode}`)}</span> <span className="text-muted-foreground">{t(`modeHint.${mode}`)}</span></span>
        </label>
      ))}
    </fieldset>
  )
}

export function BookingSettingsSection({ initialConfig }: { initialConfig: BookingConfig }) {
  const t = useTranslations('bookingSettings')
  const { form, update, save, saving, outcome } = useBookingSettings(initialConfig)
  const errors = outcome?.kind === 'fields' ? outcome.errors : {}
  const missingUrl = needsExternalUrl(form)
  // W3: statuses from GET on load, then from each save's response.
  const { loading, summary } = useBookingSettingsSummaryState()
  const saved = outcome?.kind === 'saved'
  const templates = (saved ? outcome.templates : null) ?? summary?.templates ?? null
  return (
    <Card data-testid="booking-settings-section">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <ModePicker form={form} update={update} />
        {form.mode === 'external' ? (
          <div className="space-y-1.5">
            <label htmlFor="booking-settings-url" className="text-sm font-medium">{t('externalUrl')}</label>
            <Input id="booking-settings-url" type="url" inputMode="url" placeholder="https://" value={form.externalUrl}
              onChange={(e) => update('externalUrl', e.target.value)} data-testid="booking-settings-external-url" />
            {missingUrl ? <p data-testid="booking-settings-url-warning" className="text-xs text-muted-foreground">{t('addLinkHint')}</p> : null}
            <FieldError code={errors.externalUrl} testId="booking-settings-url-error" />
          </div>
        ) : null}
        {form.mode === 'simple' ? (
          <>
            <LifetimeField kind="chat" form={form} update={update} error={errors.chatLinkTtlHours} />
            <LifetimeField kind="campaign" form={form} update={update} error={errors.campaignLinkTtlHours} />
            <div className="space-y-1.5">
              <label htmlFor="booking-settings-max" className="text-sm font-medium">{t('maxPartySize')}</label>
              <Input id="booking-settings-max" type="number" min={1} max={100} className="w-28" value={form.maxPartySize}
                onChange={(e) => update('maxPartySize', e.target.value)} data-testid="booking-settings-max-party" />
              <FieldError code={errors.maxPartySize} testId="booking-settings-max-party-error" />
            </div>
            <BookingTemplateStatusList statuses={templates} loading={loading && !saved} />
          </>
        ) : null}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || missingUrl} data-testid="booking-settings-save">{saving ? t('saving') : t('save')}</Button>
          {outcome?.kind === 'saved' ? <p data-testid="booking-settings-saved" role="status" className="text-xs text-muted-foreground">{t('saved')}</p> : null}
          {outcome?.kind === 'forbidden' || outcome?.kind === 'error' ? (
            <p data-testid="booking-settings-error" role="alert" className="text-xs text-destructive">{t(outcome.kind === 'forbidden' ? 'forbidden' : 'saveFailed')}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
