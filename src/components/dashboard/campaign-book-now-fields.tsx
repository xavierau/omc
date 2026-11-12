'use client'

/**
 * BOOK-001 W3 (AC-16/AC-17): the campaign form's Book now toggle and, in
 * External link mode, the campaign booking URL override.
 */
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { bookNowFormView } from './campaign-book-now-form'
import type { BookingAvailability } from '@/hooks/use-booking-availability'
import type { CampaignFormState, TemplateLookup } from './campaign-form-types'

interface Props {
  form: CampaignFormState
  lookup: TemplateLookup
  availability: BookingAvailability | null
  onToggle: (enabled: boolean) => void
  onChange: (key: keyof CampaignFormState, value: string) => void
}

export function CampaignBookNowFields({ form, lookup, availability, onToggle, onChange }: Props) {
  const t = useTranslations('campaigns')
  const view = bookNowFormView(form, lookup, availability)
  if (view.state === 'hidden') return null
  const disabled = view.state === 'no_link' && !form.bookNowEnabled
  return (
    <fieldset className="space-y-3 border border-input rounded-lg p-3" data-testid="campaign-book-now-section">
      <legend className="text-sm font-medium px-1">{t('bookNowTitle')}</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={form.bookNowEnabled} disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)} data-testid="campaign-book-now-toggle" />
        <span><span className="font-medium">{t('bookNowToggle')}</span> <span className="text-muted-foreground">{t('bookNowToggleHint')}</span></span>
      </label>
      {view.state === 'no_link' ? (
        <p data-testid="campaign-book-now-no-link" className="text-xs text-muted-foreground">{t('bookNowNoLink')}</p>
      ) : null}
      {view.showUrl ? (
        <div className="space-y-1">
          <label htmlFor="campaign-book-now-url" className="text-sm font-medium block">{t('bookNowUrl')}</label>
          <Input id="campaign-book-now-url" type="url" inputMode="url" placeholder="https://" value={form.bookingUrl}
            onChange={(e) => onChange('bookingUrl', e.target.value)} data-testid="campaign-book-now-url" />
          <p className="text-xs text-muted-foreground">{t('bookNowUrlHint')}</p>
        </div>
      ) : null}
      {view.issue ? (
        <p role="alert" data-testid="campaign-book-now-issue" className="text-xs text-destructive">{t(`bookNowIssue.${view.issue}`)}</p>
      ) : null}
      {view.showPreview ? (
        <p role="status" data-testid="campaign-book-now-preview" className="text-xs text-muted-foreground">{t('bookNowPreview')}</p>
      ) : null}
    </fieldset>
  )
}
