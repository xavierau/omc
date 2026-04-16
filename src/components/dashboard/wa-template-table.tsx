'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import type { WaTemplate } from '@/hooks/use-wa-templates'

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  approved: 'default',
  pending: 'outline',
  rejected: 'destructive',
  draft: 'secondary',
  paused: 'outline',
  disabled: 'secondary',
}

const statusClass: Record<string, string> = {
  approved: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  paused: 'bg-orange-100 text-orange-800 border-orange-200',
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '\u2014'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '\u2014'
  return d.toLocaleDateString('en-HK', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

interface Props {
  templates: WaTemplate[]
  onEdit?: (template: WaTemplate) => void
}

export function WaTemplateTable({ templates, onEdit }: Props) {
  const t = useTranslations('waTemplates')

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('name')}</TableHead>
          <TableHead>{t('language')}</TableHead>
          <TableHead>{t('category')}</TableHead>
          <TableHead>{t('status')}</TableHead>
          <TableHead>{t('created')}</TableHead>
          {onEdit && <TableHead className="w-[80px]">{t('actions')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {templates.map((tmpl) => (
          <TableRow key={tmpl.id}>
            <TableCell className="font-medium">{tmpl.name}</TableCell>
            <TableCell>{tmpl.language}</TableCell>
            <TableCell>{tmpl.category}</TableCell>
            <TableCell>
              <Badge
                variant={statusVariant[tmpl.status] ?? 'secondary'}
                className={statusClass[tmpl.status] ?? ''}
              >
                {tmpl.status}
              </Badge>
            </TableCell>
            <TableCell>{formatDate(tmpl.createdAt)}</TableCell>
            {onEdit && (
              <TableCell>
                <button
                  onClick={() => onEdit(tmpl)}
                  className="text-sm text-primary hover:underline"
                >
                  {t('edit')}
                </button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
