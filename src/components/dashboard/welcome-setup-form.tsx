'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCampaigns, type Campaign } from '@/hooks/use-campaigns'
import { useOnboardingSettings } from '@/hooks/use-onboarding-settings'
import {
  MAX_TEMPLATE_LENGTH,
  computePatch,
  insertAtCursor,
  isDirty,
  toDraft,
  type OnboardingDraft,
  type OnboardingPatch,
  type OnboardingSettings,
} from '@/domain/onboarding/onboarding-settings'
import { CampaignPicker, ReturningMemberField } from './welcome-setup-fields'
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

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

  function handleInsert(token: string) {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? draft.returningMemberTemplate.length
    const result = insertAtCursor(draft.returningMemberTemplate, cursor, token)
    if (result.value.length > MAX_TEMPLATE_LENGTH) return
    setDraft((d) => ({ ...d, returningMemberTemplate: result.value }))
    queueMicrotask(() => {
      const next = textareaRef.current
      if (!next) return
      next.focus()
      next.setSelectionRange(result.cursor, result.cursor)
    })
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
        <ReturningMemberField
          textareaRef={textareaRef}
          value={draft.returningMemberTemplate}
          onChange={(v) => setDraft((d) => ({ ...d, returningMemberTemplate: v }))}
          onInsert={handleInsert}
        />
        <SaveRow dirty={dirty} saving={saving} status={status} onSave={handleSave} />
      </CardContent>
    </Card>
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
