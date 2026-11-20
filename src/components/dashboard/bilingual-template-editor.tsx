'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MAX_TEMPLATE_LENGTH } from '@/domain/onboarding/onboarding-settings'
import {
  insertIntoActiveTab,
  isTabWarning,
  type BilingualValue,
  type TabKey,
} from './bilingual-template-editor-helpers'
import { PlaceholderToolbar } from './placeholder-toolbar'

export type { BilingualValue, TabKey } from './bilingual-template-editor-helpers'

export interface BilingualTemplateEditorProps {
  value: BilingualValue
  onChange: (next: BilingualValue) => void
  placeholders: readonly string[]
  idPrefix: string
  maxLength?: number
  translationNamespace?: 'welcomeSetup' | 'campaigns'
}

export function BilingualTemplateEditor(props: BilingualTemplateEditorProps) {
  const {
    value,
    onChange,
    placeholders,
    idPrefix,
    maxLength = MAX_TEMPLATE_LENGTH,
    translationNamespace = 'welcomeSetup',
  } = props
  const t = useTranslations(translationNamespace)
  const [active, setActive] = useState<TabKey>('en')
  const refs = useTabRefs()

  function handleInsert(token: string) {
    const el = refs.get(active)
    const cursor = el?.selectionStart ?? value[active].length
    const result = insertIntoActiveTab(value, active, cursor, token, maxLength)
    if (!result) return
    onChange(result.value)
    queueMicrotask(() => {
      const next = refs.get(active)
      if (!next) return
      next.focus()
      next.setSelectionRange(result.cursor, result.cursor)
    })
  }

  return (
    <Tabs value={active} onValueChange={(v) => setActive(v as TabKey)} className="w-full">
      <TabsList>
        <TabsTrigger value="en">{t('tabEn')}</TabsTrigger>
        <TabsTrigger value="zhHk">{t('tabZhHk')}</TabsTrigger>
      </TabsList>
      <LanguagePane
        tab="en"
        idPrefix={idPrefix}
        value={value.en}
        maxLength={maxLength}
        onChange={(v) => onChange({ ...value, en: v })}
        setRef={refs.setRef}
      />
      <LanguagePane
        tab="zhHk"
        idPrefix={idPrefix}
        value={value.zhHk}
        maxLength={maxLength}
        onChange={(v) => onChange({ ...value, zhHk: v })}
        setRef={refs.setRef}
      />
      <PlaceholderToolbar
        placeholders={placeholders}
        onInsert={handleInsert}
        translationNamespace={translationNamespace}
      />
    </Tabs>
  )
}

interface LanguagePaneProps {
  tab: TabKey
  idPrefix: string
  value: string
  maxLength: number
  onChange: (next: string) => void
  setRef: (tab: TabKey, el: HTMLTextAreaElement | null) => void
}

function LanguagePane({ tab, idPrefix, value, maxLength, onChange, setRef }: LanguagePaneProps) {
  const id = `${idPrefix}-${tab}`
  const countId = `${id}-count`
  const warn = isTabWarning(value.length, maxLength)
  return (
    <TabsContent value={tab}>
      <textarea
        id={id}
        ref={(el) => setRef(tab, el)}
        value={value}
        onChange={(e) => {
          if (e.target.value.length <= maxLength) onChange(e.target.value)
        }}
        rows={4}
        maxLength={maxLength}
        aria-describedby={countId}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <span
        id={countId}
        aria-live="polite"
        className={`mt-1 block text-right text-xs tabular-nums ${warn ? 'text-amber-600' : 'text-muted-foreground'}`}
      >
        {value.length} / {maxLength}
      </span>
    </TabsContent>
  )
}

interface TabRefs {
  get: (tab: TabKey) => HTMLTextAreaElement | null
  setRef: (tab: TabKey, el: HTMLTextAreaElement | null) => void
}

function useTabRefs(): TabRefs {
  const ref = useRef<Record<TabKey, HTMLTextAreaElement | null>>({ en: null, zhHk: null })
  return {
    get: (tab) => ref.current[tab],
    setRef: (tab, el) => {
      ref.current[tab] = el
    },
  }
}
