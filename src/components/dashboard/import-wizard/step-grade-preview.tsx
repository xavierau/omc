'use client'

import { useTranslations } from 'next-intl'
import { GradeBadge, type ConsentGrade } from './grade-badge'
import { PreviewRejectionsPanel } from './preview-rejections-panel'
import { CsvTagSummary } from './csv-tag-summary'
import { PreviewWarnings } from './preview-warnings'
import { buildPreviewWarnings } from './preview-warning-helpers'
import type {
  GradeBreakdown,
  ImportRowReject,
  PreviewLookups,
  PreviewRow,
} from '@/hooks/use-import-batch'

export type { PreviewRow }

interface Props {
  rows: PreviewRow[]
  rejected: ImportRowReject[]
  gradeBreakdown: GradeBreakdown
  lookups: PreviewLookups
  mergeExistingMembers: boolean
  onMergeChange: (merge: boolean) => void
  onBack: () => void
  onNext: () => void
  page?: number
  onPageChange?: (page: number) => void
}

const GRADE_KEYS: ConsentGrade[] = ['strong', 'medium', 'weak', 'none']
const PAGE_SIZE = 50

export function StepGradePreview({
  rows,
  rejected,
  gradeBreakdown,
  lookups,
  mergeExistingMembers,
  onMergeChange,
  onBack,
  onNext,
  page = 1,
  onPageChange,
}: Props) {
  const t = useTranslations('importWizard')
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const start = (page - 1) * PAGE_SIZE
  const slice = rows.slice(start, start + PAGE_SIZE)
  const { warnedPhones } = buildPreviewWarnings({ rows, lookups, merge: mergeExistingMembers })

  return (
    <div className="space-y-4" data-step="grade-preview">
      <div className="grid grid-cols-4 gap-2">
        {GRADE_KEYS.map((g) => (
          <div
            key={g}
            data-breakdown={g}
            className="rounded-md border bg-muted/30 p-3 text-center"
          >
            <div className="text-2xl font-semibold text-foreground">{gradeBreakdown[g]}</div>
            <div className="mt-1 text-xs uppercase text-muted-foreground">{t(`grade.${g}`)}</div>
          </div>
        ))}
      </div>

      <PreviewRejectionsPanel rejected={rejected} acceptedCount={rows.length} />
      <CsvTagSummary rows={rows} />

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-field="merge"
            checked={mergeExistingMembers}
            onChange={(e) => onMergeChange(e.target.checked)}
          />
          {t('mergeExistingMembers')}
        </label>
        <PreviewWarnings rows={rows} lookups={lookups} merge={mergeExistingMembers} />
      </div>

      <div className="rounded-md border" data-section="rows-table">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">{t('table.phone')}</th>
              <th className="px-3 py-2 text-left">{t('table.name')}</th>
              <th className="px-3 py-2 text-left">{t('table.grade')}</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr
                key={row.phoneE164}
                data-row={row.phoneE164}
                data-warned={warnedPhones.has(row.phoneE164) ? 'true' : undefined}
                className={warnedPhones.has(row.phoneE164) ? 'bg-amber-500/10' : undefined}
              >
                <td className="px-3 py-1.5">{row.phoneE164}</td>
                <td className="px-3 py-1.5">{row.name ?? '—'}</td>
                <td className="px-3 py-1.5"><GradeBadge grade={row.grade} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('table.pageOf', { page, total: totalPages })}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              {t('actions.prev')}
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange?.(page + 1)}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              {t('actions.nextPage')}
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground">
          {t('actions.back')}
        </button>
        <button
          type="button"
          onClick={onNext}
          data-action="next"
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {t('actions.confirm')}
        </button>
      </div>
    </div>
  )
}
