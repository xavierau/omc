'use client'

/**
 * TAG-001 F1 — merge-checkbox-sensitive warning lines for the preview step
 * (#139.2, Feedback State 3). Sanctioned extraction out of
 * `step-grade-preview.tsx` to keep that file under its line budget (see the
 * plan's F1 section). Degraded lookup states (AD-5) take priority over the
 * per-count lines: above the row cap or on a query failure, `alreadyMemberPhones`
 * / `activeConsentPhones` are both empty, so there is nothing to recompute.
 */
import { useTranslations } from 'next-intl'
import { buildPreviewWarnings } from './preview-warning-helpers'
import type { PreviewLookups, PreviewRow } from '@/hooks/use-import-batch'

interface Props {
  rows: PreviewRow[]
  lookups: PreviewLookups
  merge: boolean
}

export function PreviewWarnings({ rows, lookups, merge }: Props) {
  const t = useTranslations('importWizard')

  if (lookups.status === 'skipped_too_many_rows') {
    return (
      <p className="text-xs text-muted-foreground" data-warning="lookup-skipped">
        {t('preview.lookupSkipped', { count: rows.length })}
      </p>
    )
  }

  if (lookups.status === 'failed') {
    return (
      <p className="text-xs text-muted-foreground" data-warning="lookup-failed">
        {t('preview.lookupFailed')}
      </p>
    )
  }

  const warnings = buildPreviewWarnings({ rows, lookups, merge })

  return (
    <div className="space-y-1">
      {!merge && warnings.willSkipAlreadyMember > 0 && (
        <p className="text-xs text-amber-600" data-warning="already-member-skip">
          {t('preview.warnAlreadyMemberSkip', { count: warnings.willSkipAlreadyMember })}
        </p>
      )}
      {merge && warnings.willMerge > 0 && (
        <p className="text-xs text-muted-foreground" data-warning="already-member-merge">
          {t('preview.warnAlreadyMemberMerge', { count: warnings.willMerge })}
        </p>
      )}
      {warnings.willSkipActiveConsent > 0 && (
        <p className="text-xs text-amber-600" data-warning="active-consent">
          {t('preview.warnActiveConsent', { count: warnings.willSkipActiveConsent })}
        </p>
      )}
    </div>
  )
}
