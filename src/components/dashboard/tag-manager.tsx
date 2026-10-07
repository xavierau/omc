'use client'

// TAG-001 — Stream Bf: tenant tag list with inline create, rename and delete.
// Delete uses an inline confirm row (never a blocking window.confirm). All writes
// go through tag-client; the server re-asserts tenant ownership per request.

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { Tag } from '@/domain/entities/tag'
import { Card, CardContent } from '@/components/ui/card'
import { fetchTags, deleteTagRequest } from '@/hooks/tag-client'
import { TagForm } from '@/components/dashboard/tag-form'
import { TagRow, type TagRowMode } from '@/components/dashboard/tag-row'

export function TagManager() {
  const t = useTranslations('tags')
  const tc = useTranslations('common')
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    fetchTags()
      .then(setTags)
      .finally(() => setLoading(false))
  }, [])

  const cancel = () => {
    setEditingId(null)
    setConfirmingId(null)
  }

  const startEdit = (id: string) => {
    setConfirmingId(null)
    setEditingId(id)
  }

  const requestDelete = (id: string) => {
    setEditingId(null)
    setConfirmingId(id)
  }

  const onCreated = (tag: Tag) => setTags((prev) => [...prev, tag])

  const onRenamed = (tag: Tag) => {
    setTags((prev) => prev.map((row) => (row.id === tag.id ? tag : row)))
    cancel()
  }

  const confirmDelete = async (id: string) => {
    setBusyId(id)
    const { ok } = await deleteTagRequest(id)
    setBusyId(null)
    if (!ok) return
    setTags((prev) => prev.filter((row) => row.id !== id))
    cancel()
  }

  const modeFor = (id: string): TagRowMode =>
    editingId === id ? 'edit' : confirmingId === id ? 'confirm' : 'view'

  return (
    <Card>
      <CardContent className="space-y-4">
        <TagForm onSaved={onCreated} />
        {loading ? (
          <p className="text-sm text-muted-foreground">{tc('loading')}</p>
        ) : tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {tags.map((tag) => (
              <li key={tag.id}>
                <TagRow
                  tag={tag}
                  mode={modeFor(tag.id)}
                  busy={busyId === tag.id}
                  onEdit={() => startEdit(tag.id)}
                  onDelete={() => requestDelete(tag.id)}
                  onConfirmDelete={() => confirmDelete(tag.id)}
                  onCancel={cancel}
                  onRenamed={onRenamed}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
