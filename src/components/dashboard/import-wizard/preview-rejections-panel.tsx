'use client'

/**
 * TAG-001 F1 / #139.1 — renders every rejected preview row with its reason,
 * before commit (A16). Replaces the dead-code path in the old preview:
 * `classifyRows` always computed `rejected[]`, but nothing rendered it.
 */
import { useTranslations } from 'next-intl'
import type { ImportRowReject } from '@/hooks/use-import-batch'

interface Props {
  rejected: ImportRowReject[]
  acceptedCount: number
}

const SCROLL_THRESHOLD = 50
const MAX_RENDERED_ROWS = 500

export function PreviewRejectionsPanel({ rejected, acceptedCount }: Props) {
  const t = useTranslations('importWizard')
  const shown = rejected.slice(0, MAX_RENDERED_ROWS)

  return (
    <div data-section="preview-rejections">
      {rejected.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('preview.rejectedNone', { count: acceptedCount })}
        </p>
      ) : (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            {t('preview.rejectedTitle', { count: rejected.length })}
          </p>
          <ul
            className={
              rejected.length > SCROLL_THRESHOLD
                ? 'max-h-64 space-y-1 overflow-y-auto'
                : 'space-y-1'
            }
          >
            {shown.map((row, index) => (
              <li
                key={`${row.phoneE164}-${index}`}
                data-reject-reason={row.reason}
                className="text-xs text-muted-foreground"
              >
                {row.phoneE164} · {t(`preview.reason.${row.reason}`)}
              </li>
            ))}
          </ul>
          {rejected.length > MAX_RENDERED_ROWS && (
            <p className="text-xs text-muted-foreground" data-info="rows-capped">
              {t('preview.showingFirst', { shown: shown.length, count: rejected.length })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
