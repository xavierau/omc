'use client'

import { useTranslations } from 'next-intl'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface Member {
  id: string
  phone: string
  name: string | null
  points_balance: number
  status: string
  joined_at: string
  last_visit_at: string | null
}

interface MemberTableProps {
  members: Member[]
  search: string
  onSearchChange: (value: string) => void
  sortBy: string
  sortOrder: 'asc' | 'desc'
  onSort: (column: string) => void
  onSelectMember: (id: string) => void
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('en-HK', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function SortIndicator({ column, sortBy, sortOrder }: { column: string; sortBy: string; sortOrder: string }) {
  if (column !== sortBy) return null
  return <span className="ml-1">{sortOrder === 'asc' ? '\u2191' : '\u2193'}</span>
}

export function MemberTable({
  members,
  search,
  onSearchChange,
  sortBy,
  sortOrder,
  onSort,
  onSelectMember,
}: MemberTableProps) {
  const t = useTranslations('members')
  const tc = useTranslations('common')

  const sortableColumns = [
    { key: 'name', label: t('name') },
    { key: 'phone', label: t('phone') },
    { key: 'points_balance', label: t('points') },
    { key: 'status', label: t('status') },
    { key: 'last_visit_at', label: t('lastVisit') },
    { key: 'joined_at', label: t('joined') },
  ]

  return (
    <div className="space-y-4">
      <Input
        placeholder={t('searchPlaceholder')}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="max-w-sm"
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {sortableColumns.map((col) => (
                <TableHead
                  key={col.key}
                  className="cursor-pointer select-none hover:bg-muted/50"
                  onClick={() => onSort(col.key)}
                >
                  {col.label}
                  <SortIndicator column={col.key} sortBy={sortBy} sortOrder={sortOrder} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow
                key={member.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onSelectMember(member.id)}
              >
                <TableCell className="font-medium">{member.name || tc('unknown')}</TableCell>
                <TableCell className="text-muted-foreground">{member.phone}</TableCell>
                <TableCell>{member.points_balance}</TableCell>
                <TableCell>
                  <Badge variant={member.status === 'active' ? 'default' : 'secondary'}>
                    {member.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(member.last_visit_at)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(member.joined_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
