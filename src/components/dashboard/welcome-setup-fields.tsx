'use client'

import { useTranslations } from 'next-intl'
import type { Campaign } from '@/hooks/use-campaigns'
import {
  MAX_TEMPLATE_LENGTH,
  shouldWarnCharCount,
} from '@/domain/onboarding/onboarding-settings'

// Double-brace syntax matches the template renderer's PLACEHOLDER_RE in
// src/domain/services/template-renderer.ts and the stored campaign templates.
export const PLACEHOLDERS = ['{{greeting}}', '{{points}}', '{{contactName}}', '{{couponCode}}'] as const

export function CampaignPicker({
  value,
  onChange,
  campaigns,
}: {
  value: string
  onChange: (v: string) => void
  campaigns: Campaign[]
}) {
  const t = useTranslations('welcomeSetup')
  const id = 'welcome-campaign-id'
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground mb-1 block">
        {t('campaignLabel')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">{t('noneOption')}</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name ?? c.id}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground mt-1">{t('campaignHelper')}</p>
    </div>
  )
}

interface ReturningMemberFieldProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (v: string) => void
  onInsert: (token: string) => void
}

export function ReturningMemberField({
  textareaRef,
  value,
  onChange,
  onInsert,
}: ReturningMemberFieldProps) {
  const t = useTranslations('welcomeSetup')
  const id = 'returning-member-template'
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground mb-1 block">
        {t('returningLabel')}
      </label>
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          if (e.target.value.length <= MAX_TEMPLATE_LENGTH) onChange(e.target.value)
        }}
        rows={4}
        maxLength={MAX_TEMPLATE_LENGTH}
        placeholder={t('returningPlaceholder')}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        aria-describedby={`${id}-helper ${id}-count`}
      />
      <TemplateToolbar onInsert={onInsert} length={value.length} countId={`${id}-count`} />
      <p id={`${id}-helper`} className="text-xs text-muted-foreground mt-1">
        {t('returningHelper')}
      </p>
    </div>
  )
}

function TemplateToolbar({
  onInsert,
  length,
  countId,
}: {
  onInsert: (token: string) => void
  length: number
  countId: string
}) {
  const t = useTranslations('welcomeSetup')
  const warn = shouldWarnCharCount(length)
  return (
    <div className="flex items-center justify-between mt-1">
      <div className="flex gap-2">
        {PLACEHOLDERS.map((token) => (
          <button
            key={token}
            type="button"
            onClick={() => onInsert(token)}
            className="rounded-full border border-input bg-background px-2.5 py-0.5 text-xs font-mono hover:bg-accent hover:text-accent-foreground"
          >
            {t('insertPlaceholder')} {token}
          </button>
        ))}
      </div>
      <span
        id={countId}
        aria-live="polite"
        className={`text-xs tabular-nums ${warn ? 'text-amber-600' : 'text-muted-foreground'}`}
      >
        {length} / {MAX_TEMPLATE_LENGTH}
      </span>
    </div>
  )
}
