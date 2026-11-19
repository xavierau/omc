'use client'

/**
 * BOOK-003 (R43): "Allow AI agents" under Simple booking, admins only (the
 * setup page renders this section for admins; the API enforces it too).
 * Toggle + website host, its own Save; once on, download poppy.json (the
 * restaurant hosts it at /.well-known/poppy.json) and rotate the agent
 * booking id.
 * Review F4: the state comes from the parent section (which calls
 * useAgentBookingSettings), so leaving Simple and coming back keeps the saved
 * agent state instead of reseeding it from the page-load config.
 */
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AgentBookingOutcome, AgentBookingSettingsState } from '@/hooks/use-booking-settings'

const ERROR_KEYS: Record<string, string> = {
  error: 'saveFailed',
  forbidden: 'saveFailed',
  rotate_error: 'rotateFailed',
  download_error: 'downloadFailed',
  no_whatsapp_number: 'noWhatsappNumber',
}

function Feedback({ outcome }: { outcome: AgentBookingOutcome | null }) {
  const t = useTranslations('bookingSettings.agent')
  if (!outcome || outcome.kind === 'fields') return null
  if (outcome.kind === 'saved' || outcome.kind === 'rotated') {
    return <p data-testid="booking-agent-saved" role="status" className="text-xs text-muted-foreground">{t(outcome.kind)}</p>
  }
  return <p data-testid="booking-agent-error" role="alert" className="text-xs text-destructive">{t(ERROR_KEYS[outcome.kind])}</p>
}

function FieldError({ code, testId }: { code?: string; testId: string }) {
  const t = useTranslations('bookingSettings.agent')
  return code ? <p data-testid={testId} className="text-xs text-destructive">{t(`errors.${code}`)}</p> : null
}

function FileActions({ host, busy, onDownload, onRotate }: { host: string; busy: boolean; onDownload: () => void; onRotate: () => void }) {
  const t = useTranslations('bookingSettings.agent')
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-sm text-muted-foreground">{t('downloadHint', { host })}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onDownload} data-testid="booking-agent-download">{t('download')}</Button>
        <Button variant="ghost" size="sm" onClick={onRotate} disabled={busy} data-testid="booking-agent-rotate">
          {busy ? t('rotating') : t('rotate')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('rotateHint')}</p>
    </div>
  )
}

export function BookingAgentSettings({ agent }: { agent: AgentBookingSettingsState }) {
  const t = useTranslations('bookingSettings.agent')
  const { stored, form, update, save, rotate, download, busy, outcome } = agent
  const errors = outcome?.kind === 'fields' ? outcome.errors : {}
  const live = stored.enabled && stored.websiteHost
  return (
    <section data-testid="booking-agent-settings" className="space-y-3 border-t border-border pt-5">
      <div>
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={form.enabled} onChange={(e) => update('enabled', e.target.checked)} data-testid="booking-agent-toggle" />
        {t('toggle')}
      </label>
      <div className="space-y-1.5">
        <label htmlFor="booking-agent-host" className="text-sm font-medium">{t('websiteHost')}</label>
        <Input id="booking-agent-host" inputMode="url" placeholder="www.yourrestaurant.hk" value={form.websiteHost}
          onChange={(e) => update('websiteHost', e.target.value)} data-testid="booking-agent-host" />
        <p className="text-xs text-muted-foreground">{t('websiteHostHint')}</p>
        <FieldError code={errors.websiteHost} testId="booking-agent-host-error" />
        <FieldError code={errors.mode} testId="booking-agent-mode-error" />
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy} data-testid="booking-agent-save">{busy ? t('saving') : t('save')}</Button>
        <Feedback outcome={outcome} />
      </div>
      {live ? <FileActions host={stored.websiteHost ?? ''} busy={busy} onDownload={download} onRotate={rotate} /> : null}
    </section>
  )
}
