'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import {
  type ContactLabels,
  LABEL_TITLE_MAX_LEN,
  LABEL_MAX_LEN,
} from '@/domain/services/contact-config'

export interface ContactFormLabelFieldsProps {
  labels: ContactLabels
  onLabelChange: (field: keyof ContactLabels, value: string) => void
}

const FIELDS: { key: keyof ContactLabels; maxLength: number; labelKey: string }[] = [
  { key: 'title', maxLength: LABEL_TITLE_MAX_LEN, labelKey: 'contactLabelTitle' },
  { key: 'nameLabel', maxLength: LABEL_MAX_LEN, labelKey: 'contactLabelName' },
  { key: 'phoneLabel', maxLength: LABEL_MAX_LEN, labelKey: 'contactLabelPhone' },
  { key: 'topicLabel', maxLength: LABEL_MAX_LEN, labelKey: 'contactLabelTopic' },
  { key: 'submitLabel', maxLength: LABEL_MAX_LEN, labelKey: 'contactLabelSubmit' },
]

/** 「表格文字」fieldset: the 5 per-tenant Flow-copy fields (title + 3 input labels + submit). Pure/props-driven. */
export function ContactFormLabelFields({ labels, onLabelChange }: ContactFormLabelFieldsProps) {
  const t = useTranslations('settings')
  return (
    <fieldset className="space-y-2" data-testid="contact-form-label-fields">
      <legend className="text-sm font-medium text-foreground mb-1">{t('contactLabelsLegend')}</legend>
      {FIELDS.map(({ key, maxLength, labelKey }) => (
        <div key={key}>
          <label className="text-xs text-muted-foreground mb-1 block">{t(labelKey)}</label>
          <Input
            value={labels[key]}
            maxLength={maxLength}
            onChange={(e) => onLabelChange(key, e.target.value)}
          />
        </div>
      ))}
    </fieldset>
  )
}
