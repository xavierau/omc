'use client'

// TAG-001 F4 — split out of member-table.tsx to keep that file's delta tight
// (it's already at the 150-line budget). Two small presentational cells:
// the header select-all-on-page checkbox and the per-row selection checkbox.
import { useTranslations } from 'next-intl'
import { TableCell, TableHead } from '@/components/ui/table'

interface SelectAllHeaderCellProps {
  allSelected: boolean
  onToggleAll: () => void
}

export function SelectAllHeaderCell({ allSelected, onToggleAll }: SelectAllHeaderCellProps) {
  const t = useTranslations('members')
  return (
    <TableHead className="w-10">
      <input
        type="checkbox"
        aria-label={t('selectAllOnPage')}
        checked={allSelected}
        onChange={onToggleAll}
        data-action="select-all-on-page"
      />
    </TableHead>
  )
}

interface RowSelectCellProps {
  memberId: string
  checked: boolean
  onToggle: (id: string) => void
}

export function RowSelectCell({ memberId, checked, onToggle }: RowSelectCellProps) {
  return (
    <TableCell>
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(memberId)}
        onClick={(e) => e.stopPropagation()}
        data-action="select-member"
      />
    </TableCell>
  )
}
