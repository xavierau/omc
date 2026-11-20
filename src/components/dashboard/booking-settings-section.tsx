'use client'

/**
 * BOOK-001 AC-1/AC-2/AC-3: booking mode, external link and link lifetimes.
 * Rendered for admins only (setup page); the API enforces it too (R14).
 * BOOK-002: each booking message's text can be edited per language in an
 * inline editor under the message list.
 * BOOK-003: under Simple booking, "Allow AI agents" with its own save.
 * AGENT-005: 訂座規則 (booking rules) unless mode is off; saved with the section.
 * BOOK-009 S1: in Simple mode the booking-hours blocks come first (party size
 * moves into them), then the rules summary with Preview, then the old rules
 * textarea relabelled "Other booking notes (AI assistant only)".
 */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { needsExternalUrl, useAgentBookingSettings, useBookingSettings, type BookingSettingsForm } from '@/hooks/use-booking-settings'
import { useBookingSettingsSummaryState } from '@/hooks/use-booking-availability'
import { useBookingTemplateOverview } from '@/hooks/use-booking-template-overview'
import { BookingTemplateStatusList } from './booking-template-status-list'
import { BookingTemplateEditor } from './booking-template-editor'
import { BookingAgentSettings } from './booking-agent-settings'
import { BookingHoursBlocks } from './booking-settings/booking-hours-blocks'
import { errorCount } from './booking-settings/hours-errors'
import { BOOKING_RULES_MAX_CHARS, type BookingConfig, type BookingMode } from '@/domain/value-objects/booking-config'

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

function BookingRulesField({ form, update, error }: { form: BookingSettingsForm; update: Update; error?: string }) {
  const t = useTranslations('bookingSettings')
  return (
    <div className="space-y-1.5">
      <label htmlFor="booking-settings-rules" className="text-sm font-medium">{t('bookingRules')}</label>
      <textarea id="booking-settings-rules" rows={4} maxLength={BOOKING_RULES_MAX_CHARS} value={form.bookingRules}
        aria-describedby="booking-settings-rules-hint" aria-invalid={Boolean(error)} onChange={(e) => update('bookingRules', e.target.value)}
        data-testid="booking-settings-rules"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive" />
      <p id="booking-settings-rules-hint" data-testid="booking-settings-rules-hint" className="text-xs text-muted-foreground">{t('bookingRulesHint')}</p>
      <FieldError code={error} testId="booking-settings-rules-error" />
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

function NotSavedNotice({ errors }: { errors: Record<string, string> }) {
  const t = useTranslations('bookingSettings.bookingHours')
  const count = errorCount(errors)
  return count > 0 ? <p data-testid="booking-settings-not-saved" role="alert" className="text-xs text-destructive">{t('notSaved', { count })}</p> : null
}

export function BookingSettingsSection({ initialConfig }: { initialConfig: BookingConfig }) {
  const t = useTranslations('bookingSettings')
  const { form, update, updateHours, save: saveForm, saving, outcome, dirty } = useBookingSettings(initialConfig)
  // BOOK-009: the rules summary comes from GET; fetch it again after a save.
  const [summaryVersion, setSummaryVersion] = useState(0)
  const save = async () => {
    await saveForm()
    setSummaryVersion((v) => v + 1)
  }
  // BOOK-003 review F4: held here, above the mode switch, so the agent block's
  // saved state survives Simple → External → Simple without a save.
  const agent = useAgentBookingSettings(initialConfig.agentBooking)
  const errors = outcome?.kind === 'fields' ? outcome.errors : {}
  const missingUrl = needsExternalUrl(form)
  // W3: statuses from GET on load, then from each save's response.
  const { loading, summary } = useBookingSettingsSummaryState(summaryVersion)
  const saved = outcome?.kind === 'saved'
  const messages = useBookingTemplateOverview(summary, outcome)
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
          <BookingHoursBlocks form={form} errors={errors} onEdit={(edit) => updateHours(edit)} onMaxPartySize={(v) => update('maxPartySize', v)}
            summary={summary?.hoursSummary ?? null} dirty={Boolean(dirty)} />
        ) : null}
        {form.mode !== 'off' ? <BookingRulesField form={form} update={update} error={errors.bookingRules} /> : null}
        {form.mode === 'simple' ? (
          <>
            <LifetimeField kind="chat" form={form} update={update} error={errors.chatLinkTtlHours} />
            <LifetimeField kind="campaign" form={form} update={update} error={errors.campaignLinkTtlHours} />
            <BookingTemplateStatusList statuses={messages.templates} loading={loading && !saved}
              editor={messages.editor} editingKind={messages.editingKind} onEdit={messages.toggle} />
            {messages.editor && messages.editingKind ? (
              <BookingTemplateEditor key={messages.editingKind} kind={messages.editingKind} slots={messages.editor.slots}
                canEdit={messages.editor.canEdit} onClose={messages.close} onSaved={messages.onSaved} />
            ) : null}
          </>
        ) : null}
        {form.mode === 'simple' ? <BookingAgentSettings agent={agent} /> : null}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || missingUrl} data-testid="booking-settings-save">{saving ? t('saving') : t('save')}</Button>
          <NotSavedNotice errors={errors} />
          {outcome?.kind === 'saved' ? <p data-testid="booking-settings-saved" role="status" className="text-xs text-muted-foreground">{t('saved')}</p> : null}
          {outcome?.kind === 'forbidden' || outcome?.kind === 'error' ? (
            <p data-testid="booking-settings-error" role="alert" className="text-xs text-destructive">{t(outcome.kind === 'forbidden' ? 'forbidden' : 'saveFailed')}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
