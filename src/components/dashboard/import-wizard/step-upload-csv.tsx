'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Upload } from 'lucide-react'
import { parseCsv, type ParseCsvResult } from './parse-csv'
import { computeCsvTagStats } from './parse-csv-tag-stats'
import { MAX_ROWS, classifyParseResult } from './step-upload-csv-helpers'
import { CsvFormatHelp } from './csv-format-help'
import { CsvParseRejections } from './csv-parse-rejections'

export const EMPTY_CSV: ParseCsvResult = { phoneHeaderFound: false, rows: [], rejected: [] }

/** `File.text()` rejects (NotReadableError) when the file was moved, locked or
 *  is still being written; without this the previous parse stays on screen. */
async function readFileText(file: File): Promise<string | null> {
  try {
    return await file.text()
  } catch {
    return null
  }
}

interface Props {
  parsed: ParseCsvResult
  onParsed: (result: ParseCsvResult) => void
  onBack: () => void
  onNext: () => void
}

export function StepUploadCsv({ parsed, onParsed, onBack, onNext }: Props) {
  const t = useTranslations('importWizard')
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const tagStats = computeCsvTagStats(parsed.rows)

  async function handleFile(file: File) {
    const text = await readFileText(file)
    if (text === null) {
      setError(t('csv.errors.unreadable'))
      onParsed(EMPTY_CSV)
      return
    }
    const outcome = classifyParseResult(parseCsv(text), MAX_ROWS)
    if (outcome.kind === 'error') {
      const message =
        outcome.error === 'tooManyRows'
          ? t('csv.errors.tooManyRows', { max: MAX_ROWS })
          : t('csv.errors.empty')
      setError(message)
      onParsed(EMPTY_CSV)
      return
    }
    setError(null)
    onParsed(outcome.result)
  }

  return (
    <div className="space-y-4" data-step="upload-csv">
      <p className="text-sm text-muted-foreground">{t('csv.description')}</p>

      <CsvFormatHelp />

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
          // Reset so re-picking the same (now fixed) file fires `change` again —
          // the rejections panel makes fix-and-re-upload the primary recovery path.
          e.target.value = ''
          if (f) void handleFile(f)
        }}
      />

      {parsed.rows.length > 0 && (
        <p data-info="row-count" className="text-sm text-foreground">
          {t('csv.rowCount', { count: parsed.rows.length })}
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
      <CsvParseRejections rejected={parsed.rejected} />
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground">
          {t('actions.back')}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={parsed.rows.length === 0}
          data-action="next"
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {t('actions.next')}
        </button>
      </div>
    </div>
  )
}
