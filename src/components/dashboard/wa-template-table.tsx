'use client'

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-HK', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

interface Props {
  templates: WaTemplate[]
  onEdit?: (template: WaTemplate) => void
}

export function WaTemplateTable({ templates, onEdit }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Language</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          {onEdit && <TableHead className="w-[80px]">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {templates.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="font-medium">{t.name}</TableCell>
            <TableCell>{t.language}</TableCell>
            <TableCell>{t.category}</TableCell>
            <TableCell>
              <Badge
                variant={statusVariant[t.status] ?? 'secondary'}
                className={statusClass[t.status] ?? ''}
              >
                {t.status}
              </Badge>
            </TableCell>
            <TableCell>{formatDate(t.created_at)}</TableCell>
            {onEdit && (
              <TableCell>
                <button
                  onClick={() => onEdit(t)}
                  className="text-sm text-primary hover:underline"
                >
                  Edit
                </button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
