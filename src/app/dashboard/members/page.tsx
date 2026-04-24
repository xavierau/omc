'use client'

import { useState, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useMembers } from '@/hooks/use-members'
import { MemberTable } from '@/components/dashboard/member-table'
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

  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDebouncedSearch(value)
      setPage(1)
    }, 300)
  }, [])

  const { data, isLoading, error, refetch } = useMembers({
    search: debouncedSearch,
    page,
    sortBy,
    sortOrder,
  })

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
      <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
      <MembersContent
        data={data}
        isLoading={isLoading}
        search={search}
        onSearchChange={handleSearchChange}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        onSelectMember={handleSelectMember}
        page={page}
        onPageChange={setPage}
      />
      <MemberDetailPanel
        memberId={selectedMemberId}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
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
  onSearchChange: (value: string) => void
  sortBy: string
  sortOrder: 'asc' | 'desc'
  onSort: (column: string) => void
  onSelectMember: (id: string) => void
  page: number
  onPageChange: (page: number) => void
}

function MembersContent({
  data, isLoading, search, onSearchChange, sortBy, sortOrder, onSort, onSelectMember, page, onPageChange,
}: MembersContentProps) {
  const t = useTranslations('members')
  const tc = useTranslations('common')

  if (isLoading) return <LoadingSkeleton />

  if (data && data.members.length === 0 && !search) {
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
