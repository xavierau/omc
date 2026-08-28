'use client'

/**
 * WONB-019 B1 / #147 — always-visible CSV format contract (plan AD-5, Q-1)
 * next to the file picker on the upload step, plus the "Download CSV
 * template" action.
 */
import { useTranslations } from 'next-intl'
import { downloadImportTemplate } from './import-template'
import { MAX_ROWS } from './step-upload-csv-helpers'
import { MAX_TAGS_PER_ROW } from '@/domain/services/normalize-import-tags'

export function CsvFormatHelp() {
  const t = useTranslations('importWizard')

  return (
    <div className="space-y-2 rounded-md border border-input bg-muted/30 p-3" data-section="csv-help">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{t('csv.help.title')}</p>
        <button
          type="button"
          data-action="download-template"
          onClick={() => downloadImportTemplate()}
          className="text-xs text-muted-foreground underline"
        >
          {t('csv.downloadTemplate')}
        </button>
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li>{t('csv.help.phone')}</li>
        <li>{t('csv.help.name')}</li>
        <li>{t('csv.help.language')}</li>
        <li>{t('csv.help.tags', { maxTagsPerRow: MAX_TAGS_PER_ROW })}</li>
        <li>{t('csv.help.limits', { maxRows: MAX_ROWS })}</li>
      </ul>
    </div>
  )
}
