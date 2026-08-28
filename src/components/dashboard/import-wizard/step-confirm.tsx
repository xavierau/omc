'use client'

import { useTranslations } from 'next-intl'
import { CommitRejectionsList } from './commit-rejections-list'
import type { ImportContactsBatchResult } from '@/hooks/use-import-batch'

interface Props {
  isCommitting: boolean
  result: ImportContactsBatchResult | null
  error: string | null
  onCommit: () => void
  onBack: () => void
  onDone: () => void
}

export function StepConfirm({ isCommitting, result, error, onCommit, onBack, onDone }: Props) {
  const t = useTranslations('importWizard')

  if (result) {
    return (
      <div className="space-y-3" data-step="confirm-done">
        <h3 className="text-lg font-semibold text-foreground">{t('confirm.successTitle')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('confirm.successDescription', {
            inserted: result.inserted,
            members: result.membersCreated,
          })}
        </p>
        <ul className="text-sm text-foreground space-y-1">
          <li data-stat="strong">{t('grade.strong')}: {result.gradeBreakdown.strong}</li>
          <li data-stat="medium">{t('grade.medium')}: {result.gradeBreakdown.medium}</li>
          <li data-stat="weak">{t('grade.weak')}: {result.gradeBreakdown.weak}</li>
          <li data-stat="none">{t('grade.none')}: {result.gradeBreakdown.none}</li>
          <li data-stat="rejected">{t('confirm.rejected')}: {result.rejected.length}</li>
          {result.tagging.taggedMembers > 0 && (
            <li data-stat="tagged-members">
              {t('confirm.taggedMembers', { count: result.tagging.taggedMembers })}
            </li>
          )}
        </ul>
        {result.tagging.status === 'failed' && (
          <p className="text-xs text-destructive" data-warning="tags-failed">
            {t('confirm.tagsFailed')}
          </p>
        )}
        {result.rejected.length > 0 && (
          <CommitRejectionsList
            rejected={result.rejected}
            total={result.inserted + result.rejected.length}
          />
        )}
        <button
          type="button"
          onClick={onDone}
          data-action="done"
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {t('actions.done')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-step="confirm-pending">
      <p className="text-sm text-muted-foreground">{t('confirm.aboutToCommit')}</p>
      {error && (
        <p className="text-xs text-destructive">
          {error === 'too_many_new_tags' ? t('confirm.errors.too_many_new_tags') : error}
        </p>
      )}
      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground">
          {t('actions.back')}
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={isCommitting}
          data-action="commit"
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isCommitting ? t('actions.committing') : t('actions.commit')}
        </button>
      </div>
    </div>
  )
}
