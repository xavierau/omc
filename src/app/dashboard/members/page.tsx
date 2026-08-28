'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useMembers } from '@/hooks/use-members'
import { MemberTable } from '@/components/dashboard/member-table'
import { MemberTagFilter } from '@/components/dashboard/member-tag-filter'
import { MemberBulkTagBar } from '@/components/dashboard/member-bulk-tag-bar'
import { MemberDetailPanel } from '@/components/dashboard/member-detail-panel'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

export default function MembersPage() {
  const t = useTranslations('members')
  const tc = useTranslations('common')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('last_visit_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [tagId, setTagId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Selection is page-scoped only; changing page, search or tag filter
  // clears it directly at the point of change so the "{n} selected" count
  // never lies about what's visible (cleared alongside setPage below, not
  // via a state-syncing effect).
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDebouncedSearch(value)
      setPage(1)
      setSelectedIds([])
    }, 300)
  }, [])

  const { data, isLoading, error, refetch } = useMembers({
    search: debouncedSearch,
    page,
    sortBy,
    sortOrder,
    tagId: tagId ?? undefined,
  })

  const handleTagFilter = useCallback((id: string | null) => {
    setTagId(id)
    setPage(1)
    setSelectedIds([])
  }, [])

  const handleSort = (column: string) => {
    if (column === sortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
    }
  }

  const handleSelectMember = (id: string) => {
    setSelectedMemberId(id)
    setPanelOpen(true)
  }

  const handleToggle = (id: string) => {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    setSelectedIds([])
  }

  const handleBulkTagSuccess = () => {
    refetch()
    setSelectedIds([])
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">{t('couldntLoad')}</p>
        <Button variant="outline" onClick={refetch} className="mt-4">{tc('retry')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <Link
          href="/dashboard/members/import"
          className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          {t('importContacts')}
        </Link>
      </div>
      <MemberTagFilter tagId={tagId} onChange={handleTagFilter} />
      <MemberBulkTagBar
        selectedIds={selectedIds}
        onClear={() => setSelectedIds([])}
        onSuccess={handleBulkTagSuccess}
      />
      <MembersContent
        data={data}
        isLoading={isLoading}
        search={search}
        tagFiltered={!!tagId}
        onSearchChange={handleSearchChange}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        onSelectMember={handleSelectMember}
        page={page}
        onPageChange={handlePageChange}
        selectedIds={selectedIds}
        onToggle={handleToggle}
        onToggleAll={setSelectedIds}
      />
      <MemberDetailPanel
        memberId={selectedMemberId}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onDeleted={refetch}
        onTagsChanged={refetch}
      />
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
      ))}
    </div>
  )
}

interface MembersContentProps {
  data: ReturnType<typeof useMembers>['data']
  isLoading: boolean
  search: string
  tagFiltered: boolean
  onSearchChange: (value: string) => void
  sortBy: string
  sortOrder: 'asc' | 'desc'
  onSort: (column: string) => void
  onSelectMember: (id: string) => void
  page: number
  onPageChange: (page: number) => void
  selectedIds: string[]
  onToggle: (id: string) => void
  onToggleAll: (ids: string[]) => void
}

function MembersContent({
  data, isLoading, search, tagFiltered, onSearchChange, sortBy, sortOrder, onSort, onSelectMember, page, onPageChange,
  selectedIds, onToggle, onToggleAll,
}: MembersContentProps) {
  const t = useTranslations('members')
  const tc = useTranslations('common')

  if (isLoading) return <LoadingSkeleton />

  if (data && data.members.length === 0 && !search && !tagFiltered) {
    return (
      <EmptyState
        title={t('noMembersTitle')}
        description={t('noMembersDescription')}
        actionLabel={t('goToQrSetup')}
        actionHref="/dashboard/setup"
      />
    )
  }

  if (data && data.members.length === 0 && search) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">{t('noMatch', { search })}</p>
        <Button variant="outline" size="sm" onClick={() => onSearchChange('')} className="mt-3">
          {tc('retry')}
        </Button>
      </div>
    )
  }

  if (!data) return null

  return (
    <>
      <MemberTable
        members={data.members}
        search={search}
        onSearchChange={onSearchChange}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={onSort}
        onSelectMember={onSelectMember}
        selectedIds={selectedIds}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
      />
      {data.totalPages > 1 && (
        <PaginationSection data={data} page={page} onPageChange={onPageChange} />
      )}
    </>
  )
}

function PaginationSection({
  data,
  page,
  onPageChange,
}: {
  data: NonNullable<ReturnType<typeof useMembers>['data']>
  page: number
  onPageChange: (page: number) => void
}) {
  const tc = useTranslations('common')

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {tc('showing', {
          start: (data.page - 1) * data.pageSize + 1,
          end: Math.min(data.page * data.pageSize, data.total),
          total: data.total,
        })}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          {tc('previous')}
        </Button>
        <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => onPageChange(page + 1)}>
          {tc('next')}
        </Button>
      </div>
    </div>
  )
}
