'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Upload } from 'lucide-react'
import { parseCsv, type ParsedRow } from './parse-csv'
import { computeCsvTagStats } from './parse-csv-tag-stats'
import { MAX_ROWS, classifyParseResult } from './step-upload-csv-helpers'

interface Props {
  rows: ParsedRow[]
  onParsed: (rows: ParsedRow[]) => void
  onBack: () => void
  onNext: () => void
}

export function StepUploadCsv({ rows, onParsed, onBack, onNext }: Props) {
  const t = useTranslations('importWizard')
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const tagStats = computeCsvTagStats(rows)

  async function handleFile(file: File) {
    const text = await file.text()
    const outcome = classifyParseResult(parseCsv(text), MAX_ROWS)
    if (outcome.kind === 'error') {
      const message =
        outcome.error === 'tooManyRows'
          ? t('csv.errors.tooManyRows', { max: MAX_ROWS })
          : t('csv.errors.empty')
      setError(message)
      onParsed([])
      return
    }
    setError(null)
    onParsed(outcome.result.rows)
  }

  return (
    <div className="space-y-4" data-step="upload-csv">
      <p className="text-sm text-muted-foreground">{t('csv.description')}</p>

      <button
        type="button"
        data-action="pick-csv"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
      >
        <Upload className="size-4" />
        {t('csv.pick')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />

      {rows.length > 0 && (
        <p data-info="row-count" className="text-sm text-foreground">
          {t('csv.rowCount', { count: rows.length })}
        </p>
      )}
      {tagStats.distinctTags > 0 && (
        <p data-info="tags-found" className="text-sm text-muted-foreground">
          {t('csv.tagsFound', { count: tagStats.distinctTags })}
        </p>
      )}
      {tagStats.ignoredTagValues > 0 && (
        <p data-info="tags-ignored" className="text-xs text-amber-600">
          {t('csv.tagsIgnored', { count: tagStats.ignoredTagValues })}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground">
          {t('actions.back')}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={rows.length === 0}
          data-action="next"
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {t('actions.next')}
        </button>
      </div>
    </div>
  )
}
