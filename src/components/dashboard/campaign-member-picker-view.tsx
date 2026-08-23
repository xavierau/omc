'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { PickerMember } from '@/hooks/campaign-member-picker-client'

interface CampaignMemberPickerViewProps {
  members: PickerMember[]
  total: number
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  search: string
  selectedIds: string[]
  onSearchChange: (value: string) => void
  onToggle: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onLoadMore: () => void
}

// Pure presentational picker (no internal state) — the stateful container
// (campaign-member-picker) owns search debounce + page fetching (GH #103).
export function CampaignMemberPickerView({
  members, total, loading, loadingMore, hasMore, search, selectedIds,
  onSearchChange, onToggle, onSelectAll, onDeselectAll, onLoadMore,
}: CampaignMemberPickerViewProps) {
  const t = useTranslations('campaigns')
  const tc = useTranslations('common')

  if (loading) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>

  return (
    <div className="space-y-2">
      <Input
        placeholder={t('searchMembers')}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <PickerToolbar
        selectedCount={selectedIds.length}
        loadedCount={members.length}
        hasMore={hasMore}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        t={t}
      />
      {members.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {tc('showing', { start: 1, end: members.length, total })}
        </p>
      )}
      <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} checked={selectedIds.includes(m.id)} onToggle={onToggle} unknownLabel={tc('unknown')} />
        ))}
        {members.length === 0 && (
          <p className="text-sm text-muted-foreground p-3">{t('noMatch')}</p>
        )}
        {hasMore && (
          <div className="p-2 text-center">
            <Button type="button" variant="ghost" size="sm" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? tc('loading') : t('loadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function PickerToolbar({ selectedCount, loadedCount, hasMore, onSelectAll, onDeselectAll, t }: {
  selectedCount: number
  loadedCount: number
  hasMore: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{t('selectedCount', { count: selectedCount })}</span>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onSelectAll}>
          {hasMore ? t('selectAllLoaded', { count: loadedCount }) : t('selectAll')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDeselectAll}>
          {t('deselectAll')}
        </Button>
      </div>
    </div>
  )
}

function MemberRow({ member, checked, onToggle, unknownLabel }: {
  member: PickerMember
  checked: boolean
  onToggle: (id: string) => void
  unknownLabel: string
}) {
  return (
    <label className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-sm">
      <input type="checkbox" checked={checked} onChange={() => onToggle(member.id)} />
      <span className="font-medium">{member.name ?? unknownLabel}</span>
      <span className="text-muted-foreground ml-auto">{member.phone}</span>
    </label>
  )
}
