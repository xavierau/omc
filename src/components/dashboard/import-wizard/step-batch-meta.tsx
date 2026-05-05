'use client'

import { useTranslations } from 'next-intl'
import { ProofUploader } from './proof-uploader'
import {
  validateBatchMeta,
  type BatchMetaInput,
  type ConsentChannel,
} from './step-batch-meta-helpers'

interface Props {
  value: BatchMetaInput
  proofPath: string | null
  proofSignedUrl: string | null
  today: string
  onChange: (next: BatchMetaInput) => void
  onProofChange: (path: string | null, signedUrl: string | null) => void
  onNext: () => void
}

const CHANNELS: ConsentChannel[] = ['whatsapp', 'generic', 'service_only', 'none']

export function StepBatchMeta({
  value,
  proofPath,
  proofSignedUrl,
  today,
  onChange,
  onProofChange,
  onNext,
}: Props) {
  const t = useTranslations('importWizard')
  const errors = validateBatchMeta(value, today)
  const isValid = errors.length === 0
  const set = <K extends keyof BatchMetaInput>(key: K, v: BatchMetaInput[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <form
      className="space-y-5"
      data-step="batch-meta"
      onSubmit={(e) => {
        e.preventDefault()
        if (isValid) onNext()
      }}
    >
      <Field label={t('meta.source')} error={errors.includes('source_required') ? t('meta.errors.source_required') : null}>
        <input
          type="text"
          value={value.source}
          data-field="source"
          onChange={(e) => set('source', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('meta.dateRangeStart')}>
          <input
            type="date"
            value={value.dateRangeStart}
            data-field="dateRangeStart"
            onChange={(e) => set('dateRangeStart', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label={t('meta.dateRangeEnd')}>
          <input
            type="date"
            value={value.dateRangeEnd}
            max={today}
            data-field="dateRangeEnd"
            onChange={(e) => set('dateRangeEnd', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
      </div>
      {(errors.includes('date_range_invalid') || errors.includes('date_range_future')) && (
        <p data-error="date_range" className="text-xs text-destructive">
          {t(`meta.errors.${errors.includes('date_range_future') ? 'date_range_future' : 'date_range_invalid'}`)}
        </p>
      )}

      <Field label={t('meta.consentTextShown')} error={errors.includes('consent_text_too_short') ? t('meta.errors.consent_text_too_short') : null}>
        <textarea
          value={value.consentTextShown}
          data-field="consentTextShown"
          onChange={(e) => set('consentTextShown', e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </Field>

      <Field label={t('meta.consentChannel')}>
        <select
          value={value.consentChannel}
          data-field="consentChannel"
          onChange={(e) => set('consentChannel', e.target.value as ConsentChannel)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(`channel.${c}`)}
            </option>
          ))}
        </select>
      </Field>

      {value.consentChannel === 'whatsapp' && (
        <Field label={t('meta.proof')} error={errors.includes('proof_required_for_whatsapp') ? t('meta.errors.proof_required_for_whatsapp') : null}>
          <ProofUploader
            storagePath={proofPath}
            signedUrl={proofSignedUrl}
            onUploaded={(r) => onProofChange(r.storagePath, r.signedUrl)}
            onCleared={() => onProofChange(null, null)}
          />
        </Field>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!isValid}
          data-action="next"
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {t('actions.next')}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
