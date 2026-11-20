'use client'

// TAG-001 — Stream Bf: inline create/rename form. No `tag` prop → POST (create);
// with a `tag` prop → PATCH (rename). A 409 from the route surfaces the localized
// tags.duplicateName message; the server owns tenant scoping (getTenantContext()).

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { Tag } from '@/domain/entities/tag'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  createTagRequest,
  renameTagRequest,
  type TagMutationResult,
} from '@/hooks/tag-client'

interface TagFormProps {
  onSaved: (tag: Tag) => void
  tag?: Tag
  onCancel?: () => void
}

export function TagForm({ onSaved, tag, onCancel }: TagFormProps) {
  const t = useTranslations('tags')
  const tc = useTranslations('common')
  const [name, setName] = useState(tag?.name ?? '')
  const [error, setError] = useState<'duplicateName' | 'saveError' | null>(null)
  const [busy, setBusy] = useState(false)

  const save = (value: string): Promise<TagMutationResult> =>
    tag ? renameTagRequest(tag.id, value) : createTagRequest(value)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    const result = await save(trimmed)
    setBusy(false)
    if (result.ok && result.tag) {
      onSaved(result.tag)
      if (!tag) setName('')
      return
    }
    setError(result.duplicate ? 'duplicateName' : 'saveError')
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('name')}
        aria-label={t('name')}
        maxLength={40}
        className="max-w-56"
      />
      <Button type="submit" size="sm" disabled={busy || !name.trim()}>
        {tag ? tc('save') : t('create')}
      </Button>
      {onCancel && (
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {tc('cancel')}
        </Button>
      )}
      {error && (
        <span className="text-xs text-destructive" role="alert">
          {error === 'duplicateName' ? t('duplicateName') : tc('somethingWentWrong')}
        </span>
      )}
    </form>
  )
}
