'use client'

/**
 * WONB-018 A2 / #148 — shows every row `parseCsv` could not read (bad
 * quoting, a shifted column count) before commit, so it can never be
 * imported mangled. Mirrors `preview-rejections-panel.tsx` visually; renders
 * nothing when there is nothing to show (plan AD-3).
 */
import { useTranslations } from 'next-intl'
import type { CsvParseReject } from './parse-csv'

interface Props {
  rejected: CsvParseReject[]
}

const SCROLL_THRESHOLD = 50
const MAX_RENDERED_ROWS = 500

export function CsvParseRejections({ rejected }: Props) {
  const t = useTranslations('importWizard')
  if (rejected.length === 0) return null

  const shown = rejected.slice(0, MAX_RENDERED_ROWS)

  return (
    <div
      className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3"
      data-section="csv-parse-rejections"
    >
      <p className="text-sm font-medium text-destructive">
        {t('csv.rejectedTitle', { count: rejected.length })}
      </p>
      <ul
        className={
          rejected.length > SCROLL_THRESHOLD ? 'max-h-64 space-y-1 overflow-y-auto' : 'space-y-1'
        }
      >
        {shown.map((row, index) => (
          <li
            key={`${row.line}-${index}`}
            data-reject-reason={row.reason}
            data-reject-line={row.line}
            className="text-xs text-muted-foreground"
          >
            {t('csv.rejectLine', { line: row.line })}{row.phone ? ` · ${row.phone}` : ''} ·{' '}
            {t(`csv.reason.${row.reason}`, { expected: row.expected, actual: row.actual })}
          </li>
        ))}
      </ul>
      {rejected.length > MAX_RENDERED_ROWS && (
        <p className="text-xs text-muted-foreground" data-info="rows-capped">
          {t('csv.showingFirst', { shown: shown.length, count: rejected.length })}
        </p>
      )}
    </div>
  )
}
