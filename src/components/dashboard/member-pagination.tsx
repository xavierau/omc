'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 250] as const

interface MemberPaginationProps {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function MemberPagination({
  page, pageSize, total, totalPages, onPageChange, onPageSizeChange,
}: MemberPaginationProps) {
  const t = useTranslations('members')
  const tc = useTranslations('common')
  const last = Math.max(totalPages, 1)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {tc('showing', {
          start: (page - 1) * pageSize + 1,
          end: Math.min(page * pageSize, total),
          total,
        })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('pageSizeLabel')}
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            data-testid="members-page-size-select"
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(1)}
          data-testid="members-pagination-first">{t('pageFirst')}</Button>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}
          data-testid="members-pagination-prev">{t('pagePrevious')}</Button>
        <span className="text-sm text-foreground">{t('pageOf', { page, total: last })}</span>
        <Button variant="outline" size="sm" disabled={page >= last} onClick={() => onPageChange(page + 1)}
          data-testid="members-pagination-next">{t('pageNext')}</Button>
        <Button variant="outline" size="sm" disabled={page >= last} onClick={() => onPageChange(last)}
          data-testid="members-pagination-last">{t('pageLast')}</Button>
      </div>
    </div>
  )
}
