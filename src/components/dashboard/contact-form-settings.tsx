'use client'

import { type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { DEFAULT_ACK_TEXT, ACK_MAX_LEN, TOPIC_MAX_LEN, type ContactLabels } from '@/domain/services/contact-config'
import { ContactFormLabelFields } from '@/components/dashboard/contact-form-label-fields'

export interface ContactFormSettingsProps {
  notificationEmail: string
  onNotificationEmailChange: (value: string) => void
  emailInvalid: boolean
  topics: string[]
  onTopicChange: (index: number, value: string) => void
  ackText: string
  onAckTextChange: (value: string) => void
  labels: ContactLabels
  onLabelChange: (field: keyof ContactLabels, value: string) => void
}

/** Form-mode fields: notification email, exactly 5 topics, ack text, form-copy labels. Pure/props-driven. */
export function ContactFormSettings({
  notificationEmail,
  onNotificationEmailChange,
  emailInvalid,
  topics,
  onTopicChange,
  ackText,
  onAckTextChange,
  labels,
  onLabelChange,
}: ContactFormSettingsProps) {
  const t = useTranslations('settings')
  return (
    <div className="space-y-4 border-t border-border pt-4" data-testid="contact-form-settings">
      <Field label={t('contactNotificationEmailLabel')}>
        <Input
          type="email"
          value={notificationEmail}
          onChange={(e) => onNotificationEmailChange(e.target.value)}
          placeholder={t('contactNotificationEmailPlaceholder')}
          aria-invalid={emailInvalid}
        />
        {emailInvalid && (
          <p className="text-xs text-destructive mt-1">{t('contactNotificationEmailRequired')}</p>
        )}
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground mb-1">{t('contactTopicsLabel')}</legend>
        {topics.map((topic, index) => (
          <Input
            key={index}
            value={topic}
            maxLength={TOPIC_MAX_LEN}
            placeholder={t('contactTopicPlaceholder', { n: index + 1 })}
            onChange={(e) => onTopicChange(index, e.target.value)}
          />
        ))}
      </fieldset>
      <Field label={t('contactAckTextLabel')}>
        <textarea
          value={ackText}
          placeholder={DEFAULT_ACK_TEXT}
          maxLength={ACK_MAX_LEN}
          rows={3}
          onChange={(e) => onAckTextChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </Field>
      <ContactFormLabelFields labels={labels} onLabelChange={onLabelChange} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground mb-1 block">
        {label}
      </label>
      {children}
    </div>
  )
}
