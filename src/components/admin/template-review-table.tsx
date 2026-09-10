'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import type { TemplateReviewItem } from '@/hooks/use-admin-template-reviews'

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-HK', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface Props {
  reviews: TemplateReviewItem[]
  onReview: (review: TemplateReviewItem) => void
}

export function TemplateReviewTable({ reviews, onReview }: Props) {
  const t = useTranslations('adminTemplateReviews')

  if (reviews.length === 0) {
    return <p className="text-muted-foreground">{t('noReviews')}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('tenant')}</TableHead>
          <TableHead>{t('template')}</TableHead>
          <TableHead className="text-right">{t('audienceSize')}</TableHead>
          <TableHead>{t('contentPreview')}</TableHead>
          <TableHead>{t('submittedAt')}</TableHead>
          <TableHead className="w-[100px]">{t('actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.restaurantId}</TableCell>
            <TableCell>{r.templateName}</TableCell>
            <TableCell className="text-right">{r.targetAudienceSize ?? '—'}</TableCell>
            <TableCell
              className="max-w-[280px] truncate"
              title={r.contentPreview ?? undefined}
            >
              {r.contentPreview ?? '—'}
            </TableCell>
            <TableCell>{formatDate(r.submittedAt)}</TableCell>
            <TableCell>
              <Button variant="outline" size="sm" onClick={() => onReview(r)}>
                {r.status === 'pending' ? t('review') : t('view')}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
