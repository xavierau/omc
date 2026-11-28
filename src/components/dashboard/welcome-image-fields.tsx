'use client'

import { useTranslations } from 'next-intl'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CampaignImageUploader } from './campaign-image-uploader'
import type { CampaignFormState } from './campaign-form-types'

type OnChange = (key: keyof CampaignFormState, value: string) => void

interface Props {
  form: CampaignFormState
  campaignId: string | null
  draftNonce: string
  onChange: OnChange
}

/**
 * Bilingual welcome-image uploader block (ONBOARD-010). Rendered only when
 * `form.type === 'welcome'` by the parent — scope is locked to welcome
 * campaigns for this phase. Each language tab holds an independent uploader
 * because the send-time resolver does STRICT per-language matching (no
 * cross-language fallback); an EN member never sees a ZH-only image.
 */
export function WelcomeImageFields({ form, campaignId, draftNonce, onChange }: Props) {
  const t = useTranslations('campaigns')
  return (
    <fieldset className="space-y-3 border border-input rounded-lg p-3">
      <legend className="text-sm font-medium px-1">{t('imageUploadLabel')}</legend>
      <p className="text-xs text-muted-foreground">{t('imageUploadHelper')}</p>
      <Tabs defaultValue="en" className="w-full">
        <TabsList>
          <TabsTrigger value="en">{t('tabEn')}</TabsTrigger>
          <TabsTrigger value="zhHk">{t('tabZhHk')}</TabsTrigger>
        </TabsList>
        <TabsContent value="en">
          <CampaignImageUploader
            lang="en"
            campaignId={campaignId}
            draftNonce={draftNonce}
            currentUrl={form.imageUrlEn}
            onUploaded={(url) => onChange('imageUrlEn', url)}
            onRemoved={() => onChange('imageUrlEn', '')}
          />
        </TabsContent>
        <TabsContent value="zhHk">
          <CampaignImageUploader
            lang="zhHk"
            campaignId={campaignId}
            draftNonce={draftNonce}
            currentUrl={form.imageUrlZhHk}
            onUploaded={(url) => onChange('imageUrlZhHk', url)}
            onRemoved={() => onChange('imageUrlZhHk', '')}
          />
        </TabsContent>
      </Tabs>
    </fieldset>
  )
}
