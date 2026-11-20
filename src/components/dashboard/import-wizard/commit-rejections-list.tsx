'use client'

/**
 * TAG-001 F2 / #139.3 — post-commit rejected rows, grouped by reason, with a
 * "Copy list" clipboard action and a "Download CSV" action. Renders nothing
 * when there is nothing rejected; the existing `data-stat="rejected"` count
 * line on `step-confirm.tsx` stays either way.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  groupRejectionsByReason,
  toClipboardText,
  toRejectionsCsv,
} from './commit-rejections-helpers'
import type { ImportRowReject } from '@/hooks/use-import-batch'

interface Props {
  rejected: ImportRowReject[]
  total: number
}

const COPIED_DURATION_MS = 2000
const CSV_FILENAME = 'rejected-rows.csv'
const MAX_RENDERED_ROWS = 500

export function CommitRejectionsList({ rejected, total }: Props) {
  const t = useTranslations('importWizard')
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  if (rejected.length === 0) return null

  const groups = groupRejectionsByReason(rejected)

  async function handleCopy() {
    if (!navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(toClipboardText(rejected))
      setCopied(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopied(false), COPIED_DURATION_MS)
    } catch {
      // Clipboard permission denied or unsupported — the buttons stay usable,
      // just nothing is copied. Never an unhandled rejection.
    }
  }

  function handleDownload() {
    const blob = new Blob([toRejectionsCsv(rejected)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = CSV_FILENAME
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3"
      data-section="commit-rejections"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-destructive">
          {t('confirm.rejectedTitle', { count: rejected.length, total })}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleCopy}
            data-action="copy-rejections"
            className="text-xs text-muted-foreground underline"
          >
            {copied ? t('confirm.copied') : t('confirm.copy')}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            data-action="download-rejections"
            className="text-xs text-muted-foreground underline"
          >
            {t('confirm.downloadCsv')}
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {groups.map((group) => {
          const shown = group.rows.slice(0, MAX_RENDERED_ROWS)
          return (
            <details key={group.reason} data-reason-group={group.reason}>
              <summary className="cursor-pointer text-xs font-medium text-foreground">
                {t(`preview.reason.${group.reason}`)} ({group.rows.length})
              </summary>
              <ul className="space-y-0.5 pl-4">
                {shown.map((row, index) => (
                  <li key={`${row.phoneE164}-${index}`} className="text-xs text-muted-foreground">
                    {row.phoneE164}
                    {row.message ? ` · ${row.message}` : ''}
                  </li>
                ))}
              </ul>
              {group.rows.length > MAX_RENDERED_ROWS && (
                <p className="pl-4 text-xs text-muted-foreground" data-info="rows-capped">
                  {t('confirm.showingFirst', { shown: shown.length, count: group.rows.length })}
                </p>
              )}
            </details>
          )
        })}
      </div>
    </div>
  )
}
