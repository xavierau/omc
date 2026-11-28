'use client'

/** BOOK-014 W2 (spec S2 AC-3): the deposit rule's inputs; whole currency units, the server validates (R53). */
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { DEPOSIT_REFUND_NOTE_MAX, type DepositMode } from '@/domain/value-objects/deposit-rule'
import type { DepositForm } from '@/hooks/use-booking-settings'
import { Segmented } from './segmented'

const MODES: DepositMode[] = ['per_guest', 'per_booking']
const LANGS = ['zh_hk', 'en'] as const
const TEXTAREA = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive'

interface Props { deposit: DepositForm; onChange: (d: DepositForm) => void; currency: string; errors: Record<string, string> }

function NumberField({ id, label, value, invalid, onValue, testId }: { id: string; label: string; value: string; invalid: boolean; onValue: (v: string) => void; testId: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <Input id={id} type="number" inputMode="numeric" min={1} step={1} className="w-32" value={value} aria-invalid={invalid}
        onChange={(e) => onValue(e.target.value)} data-testid={testId} />
    </div>
  )
}

export function DepositFields({ deposit, onChange, currency, errors }: Props) {
  const t = useTranslations('bookingSettings.deposit')
  const set = (patch: Partial<DepositForm>) => onChange({ ...deposit, ...patch })
  return (
    <div className="space-y-4">
      <Segmented label={t('modeLabel')} value={deposit.mode} options={MODES.map((m) => ({ value: m, label: t(`mode.${m}`) }))}
        onChange={(mode) => set({ mode })} testId="booking-settings-deposit-mode" />
      <div className="flex flex-wrap gap-4">
        <NumberField id="booking-settings-deposit-amount" label={t('amount', { currency })} value={deposit.amount} invalid={Boolean(errors['deposit.amount'])}
          onValue={(amount) => set({ amount })} testId="booking-settings-deposit-amount" />
        <NumberField id="booking-settings-deposit-from" label={t('fromPartySize')} value={deposit.fromPartySize} invalid={Boolean(errors['deposit.fromPartySize'])}
          onValue={(fromPartySize) => set({ fromPartySize })} testId="booking-settings-deposit-from" />
      </div>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1.5 text-sm font-medium">{t('refundTitle')}</legend>
        {LANGS.map((lang) => (
          <div key={lang} className="space-y-1.5">
            <label htmlFor={`booking-settings-deposit-note-${lang}`} className="text-xs text-muted-foreground">{t(`refundLang.${lang}`)}</label>
            <textarea id={`booking-settings-deposit-note-${lang}`} rows={3} maxLength={DEPOSIT_REFUND_NOTE_MAX} lang={lang === 'zh_hk' ? 'zh-HK' : 'en'}
              value={deposit.refundNote[lang]} aria-invalid={Boolean(errors['deposit.refundNote'])} data-testid={`booking-settings-deposit-note-${lang}`}
              onChange={(e) => set({ refundNote: { ...deposit.refundNote, [lang]: e.target.value } })} className={TEXTAREA} />
          </div>
        ))}
      </fieldset>
    </div>
  )
}
