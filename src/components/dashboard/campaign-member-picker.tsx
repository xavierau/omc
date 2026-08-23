'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { CampaignMemberPickerView } from './campaign-member-picker-view'
import { fetchMemberPage, PICKER_PAGE_SIZE, type PickerMember } from '@/hooks/campaign-member-picker-client'

const SEARCH_DEBOUNCE_MS = 300

interface CampaignMemberPickerProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

// Stateful container — owns search debounce + server-side page fetching.
// Search now hits GET /api/dashboard/members?search=... instead of filtering
// a single client-loaded page, and members accumulate across "Load more"
// pages so "Select all" can honestly cover the full loaded result (GH #103).
export function CampaignMemberPicker({ selectedIds, onChange }: CampaignMemberPickerProps) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [members, setMembers] = useState<PickerMember[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const load = useCallback((targetPage: number, term: string, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    fetchMemberPage({ search: term, page: targetPage, pageSize: PICKER_PAGE_SIZE })
      .then((result) => {
        setMembers((prev) => (append ? [...prev, ...result.members] : result.members))
        setTotal(result.total)
        setPage(result.page)
        setTotalPages(result.totalPages)
      })
      .catch(() => { if (!append) setMembers([]) })
      .finally(() => (append ? setLoadingMore(false) : setLoading(false)))
  }, [])

  useEffect(() => {
    load(1, debouncedSearch, false)
  }, [debouncedSearch, load])

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedSearch(value), SEARCH_DEBOUNCE_MS)
  }, [])

  const toggle = (id: string) => onChange(
    selectedIds.includes(id) ? selectedIds.filter((sid) => sid !== id) : [...selectedIds, id]
  )

  return (
    <CampaignMemberPickerView
      members={members}
      total={total}
      loading={loading}
      loadingMore={loadingMore}
      hasMore={page < totalPages}
      search={search}
      selectedIds={selectedIds}
      onSearchChange={handleSearchChange}
      onToggle={toggle}
      onSelectAll={() => onChange(members.map((m) => m.id))}
      onDeselectAll={() => onChange([])}
      onLoadMore={() => load(page + 1, debouncedSearch, true)}
    />
  )
}
