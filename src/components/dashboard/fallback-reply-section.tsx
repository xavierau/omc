'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  buildHelpText,
  UNKNOWN_EN,
  UNKNOWN_ZH,
  JOIN_INVITE_EN,
  JOIN_INVITE_ZH,
} from '@/app/api/webhooks/whatsapp/fallback-menu'
import {
  REPLY_TEXT_MAX,
  type ResolvedReplyConfig,
  type ReplyFeatureKey,
  type ReplyFeatures,
  type ReplyTextKey,
  type LocalizedText,
} from '@/domain/services/reply-config'

interface Props {
  initialConfig: ResolvedReplyConfig
}

type Bilingual = { en: string; zh: string }
type TextState = Record<ReplyTextKey, Bilingual>

const FEATURE_ROWS: { key: ReplyFeatureKey; labelKey: string }[] = [
  { key: 'points', labelKey: 'featurePoints' },
  { key: 'rewards', labelKey: 'featureRewards' },
  { key: 'redeem', labelKey: 'featureRedeem' },
  { key: 'card', labelKey: 'featureCard' },
  { key: 'help', labelKey: 'featureHelp' },
]

const MESSAGE_ROWS: { key: ReplyTextKey; labelKey: string }[] = [
  { key: 'unknown', labelKey: 'unknownTextLabel' },
  { key: 'help', labelKey: 'helpTextLabel' },
  { key: 'join', labelKey: 'joinTextLabel' },
]

function toBilingual(text: LocalizedText): Bilingual {
  return { en: text.en ?? '', zh: text.zh ?? '' }
}

export function FallbackReplySection({ initialConfig }: Props) {
  const t = useTranslations('settings')
  const [features, setFeatures] = useState<ReplyFeatures>(initialConfig.features)
  const [text, setText] = useState<TextState>({
    unknown: toBilingual(initialConfig.text.unknown),
    help: toBilingual(initialConfig.text.help),
    join: toBilingual(initialConfig.text.join),
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Placeholders show the stock default so "empty = use default" is obvious.
  // The HELP default reflects the currently-enabled functions.
  const placeholders: TextState = {
    unknown: { en: UNKNOWN_EN, zh: UNKNOWN_ZH },
    help: { en: buildHelpText(true, features), zh: buildHelpText(false, features) },
    join: { en: JOIN_INVITE_EN, zh: JOIN_INVITE_ZH },
  }

  function toggle(key: ReplyFeatureKey) {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }))
    setSaved(false)
  }

  function editText(key: ReplyTextKey, lang: keyof Bilingual, value: string) {
    setText((prev) => ({ ...prev, [key]: { ...prev[key], [lang]: value } }))
    setSaved(false)
  }

  async function save() {
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/settings/reply-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features, text }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSaved(true)
    } catch {
      setError(t('replySaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('fallbackReplyTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('fallbackReplyDescription')}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground mb-1">
            {t('featuresLabel')}
          </legend>
          {FEATURE_ROWS.map(({ key, labelKey }) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={features[key]}
                onChange={() => toggle(key)}
              />
              {t(labelKey)}
            </label>
          ))}
        </fieldset>

        {MESSAGE_ROWS.map(({ key, labelKey }) => (
          <div key={key} className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t(labelKey)}</p>
            <LangField
              lang={t('textEn')}
              value={text[key].en}
              placeholder={placeholders[key].en}
              maxLength={REPLY_TEXT_MAX[key]}
              onChange={(v) => editText(key, 'en', v)}
            />
            <LangField
              lang={t('textZh')}
              value={text[key].zh}
              placeholder={placeholders[key].zh}
              maxLength={REPLY_TEXT_MAX[key]}
              onChange={(v) => editText(key, 'zh', v)}
            />
            <p className="text-xs text-muted-foreground">{t('useDefaultHint')}</p>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </Button>
          {saved && (
            <p className="text-xs text-muted-foreground">{t('replySaved')}</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

function LangField({
  lang,
  value,
  placeholder,
  maxLength,
  onChange,
}: {
  lang: string
  value: string
  placeholder: string
  maxLength: number
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{lang}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </label>
  )
}
