'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCampaigns, type Campaign } from '@/hooks/use-campaigns'
import { useOnboardingSettings } from '@/hooks/use-onboarding-settings'
import {
  computePatch,
  isDirty,
  toDraft,
  type OnboardingDraft,
  type OnboardingPatch,
  type OnboardingSettings,
} from '@/domain/onboarding/onboarding-settings'
import type { LanguageCode } from '@/domain/value-objects/language'
import { BilingualTemplateEditor } from './bilingual-template-editor'
import {
  CampaignPicker,
  DefaultLanguageSelect,
  PLACEHOLDERS,
} from './welcome-setup-fields'
import { SaveRow, type SaveStatus } from './welcome-setup-save-row'

export function WelcomeSetupForm() {
  const t = useTranslations('welcomeSetup')
  const { campaigns } = useCampaigns()
  const { settings, loading, saving, saveSettings } = useOnboardingSettings()

  if (loading || !settings) {
    return <WelcomeSetupSkeleton title={t('title')} description={t('description')} />
  }

  return (
    <WelcomeSetupCard
      settings={settings}
      campaigns={campaigns.filter((c) => c.status === 'active' && c.type === 'welcome')}
      saving={saving}
      onSave={saveSettings}
    />
  )
}

interface CardProps {
  settings: OnboardingSettings
  campaigns: Campaign[]
  saving: boolean
  onSave: (patch: OnboardingPatch) => Promise<OnboardingSettings>
}

function WelcomeSetupCard({ settings, campaigns, saving, onSave }: CardProps) {
  const t = useTranslations('welcomeSetup')
  const [draft, setDraft] = useState<OnboardingDraft>(() => toDraft(settings))
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })

  useEffect(() => {
    setDraft(toDraft(settings))
  }, [settings])

  const dirty = isDirty(settings, draft)

  async function handleSave() {
    try {
      await onSave(computePatch(settings, draft))
      setStatus({ kind: 'success' })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Error' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <CampaignPicker
          value={draft.welcomeCampaignId}
          onChange={(v) => setDraft((d) => ({ ...d, welcomeCampaignId: v }))}
          campaigns={campaigns}
        />
        <DefaultLanguageSelect
          value={draft.defaultLanguage}
          onChange={(v: LanguageCode) => setDraft((d) => ({ ...d, defaultLanguage: v }))}
        />
        <ReturningTemplateSection draft={draft} setDraft={setDraft} />
        <SaveRow dirty={dirty} saving={saving} status={status} onSave={handleSave} />
      </CardContent>
    </Card>
  )
}

function ReturningTemplateSection({
  draft,
  setDraft,
}: {
  draft: OnboardingDraft
  setDraft: React.Dispatch<React.SetStateAction<OnboardingDraft>>
}) {
  const t = useTranslations('welcomeSetup')
  return (
    <div>
      <label className="text-sm font-medium text-foreground mb-1 block">
        {t('returningLabel')}
      </label>
      <BilingualTemplateEditor
        idPrefix="returning-member-template"
        placeholders={PLACEHOLDERS}
        value={{
          en: draft.returningMemberTemplateEn,
          zhHk: draft.returningMemberTemplateZhHk,
        }}
        onChange={(next) =>
          setDraft((d) => ({
            ...d,
            returningMemberTemplateEn: next.en,
            returningMemberTemplateZhHk: next.zhHk,
          }))
        }
      />
      <p className="text-xs text-muted-foreground mt-1">{t('returningHelper')}</p>
    </div>
  )
}

function WelcomeSetupSkeleton({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <div className="h-9 w-full rounded-md bg-muted animate-pulse mb-4" />
        <div className="h-24 w-full rounded-md bg-muted animate-pulse" />
      </CardContent>
    </Card>
  )
}
