'use client'

/**
 * TAG-001 F1 / AD-10 — shows every distinct tag across accepted preview rows
 * with its row count, and marks which are new for the tenant (A2). Fetches
 * the tenant tag list with the existing `fetchTags()` — no new endpoint.
 * Renders nothing when no accepted row carries a tag.
 */
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { fetchTags } from '@/hooks/tag-client'
import { summariseRowTags } from './csv-tag-summary-helpers'
import type { Tag } from '@/domain/entities/tag'
import type { PreviewRow } from '@/hooks/use-import-batch'

interface Props {
  rows: PreviewRow[]
}

export function CsvTagSummary({ rows }: Props) {
  const t = useTranslations('importWizard')
  const [existingTags, setExistingTags] = useState<Tag[]>([])
  const hasAnyTaggedRow = rows.some((row) => row.tags.length > 0)

  useEffect(() => {
    if (!hasAnyTaggedRow) return
    fetchTags().then(setExistingTags).catch(() => setExistingTags([]))
  }, [hasAnyTaggedRow])

  const summary = summariseRowTags(rows, existingTags)
  if (summary.length === 0) return null

  const newCount = summary.filter((entry) => entry.isNew).length

  return (
    <div className="space-y-2" data-section="csv-tag-summary">
      <p className="text-sm font-medium text-foreground">{t('tagSummary.title')}</p>
      <div className="flex flex-wrap gap-2">
        {summary.map((entry) => (
          <span
            key={entry.name}
            data-tag-new={entry.isNew ? 'true' : 'false'}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs text-foreground"
          >
            {t('tagSummary.perTag', { name: entry.name, count: entry.count })}
            {entry.isNew && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {t('tagSummary.newBadge')}
              </span>
            )}
          </span>
        ))}
      </div>
      {newCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('tagSummary.newCount', { count: newCount })}
        </p>
      )}
    </div>
  )
}
