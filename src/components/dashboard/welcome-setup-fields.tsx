'use client'

import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Campaign } from '@/hooks/use-campaigns'
import type { LanguageCode } from '@/domain/value-objects/language'
import {
  missingCampaignLanguages,
  type CampaignLike,
} from '@/domain/onboarding/onboarding-settings'

// Double-brace syntax matches the template renderer's PLACEHOLDER_RE in
// src/domain/services/template-renderer.ts and the stored campaign templates.
export const PLACEHOLDERS = [
  '{{greeting}}',
  '{{points}}',
  '{{contactName}}',
  '{{couponCode}}',
] as const

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

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
        className={selectClass}
      >
        <option value="">{t('noneOption')}</option>
        {campaigns.map((c) => (
          <CampaignOption key={c.id} campaign={c} />
        ))}
      </select>
      <MissingTranslationLegend campaigns={campaigns} />
      <p className="text-xs text-muted-foreground mt-1">{t('campaignHelper')}</p>
    </div>
  )
}

function CampaignOption({ campaign }: { campaign: Campaign }) {
  const missing = missingCampaignLanguages(toCampaignLike(campaign))
  const label = campaign.name ?? campaign.id
  const suffix = missing.length > 0 ? ' \u26A0' : ''
  return (
    <option value={campaign.id}>
      {label}
      {suffix}
    </option>
  )
}

function MissingTranslationLegend({ campaigns }: { campaigns: Campaign[] }) {
  const t = useTranslations('welcomeSetup')
  const problematic = campaigns.filter(
    (c) => missingCampaignLanguages(toCampaignLike(c)).length > 0
  )
  if (problematic.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {problematic.map((c) => {
        const missing = missingCampaignLanguages(toCampaignLike(c))
        return (
          <li key={c.id} className="flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle aria-hidden="true" className="size-3.5" />
            <span>
              {c.name ?? c.id}
              {': '}
              {t('missingTranslationWarning', {
                language: missing.map((m) => t(languageLabelKey(m))).join(', '),
              })}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function languageLabelKey(code: LanguageCode): 'languageEn' | 'languageZhHk' {
  return code === 'en' ? 'languageEn' : 'languageZhHk'
}

function toCampaignLike(campaign: Campaign): CampaignLike {
  const wide = campaign as Campaign & {
    templateEn?: string | null
    templateZhHk?: string | null
  }
  return { templateEn: wide.templateEn ?? null, templateZhHk: wide.templateZhHk ?? null }
}

export function DefaultLanguageSelect({
  value,
  onChange,
}: {
  value: LanguageCode
  onChange: (v: LanguageCode) => void
}) {
  const t = useTranslations('welcomeSetup')
  const id = 'default-language'
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground mb-1 block">
        {t('defaultLanguageLabel')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as LanguageCode)}
        className={selectClass}
      >
        <option value="zh_hk">{t('languageZhHk')}</option>
        <option value="en">{t('languageEn')}</option>
      </select>
      <p className="text-xs text-muted-foreground mt-1">{t('defaultLanguageHelper')}</p>
    </div>
  )
}
