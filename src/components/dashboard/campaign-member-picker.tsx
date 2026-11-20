'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { CampaignMemberPickerView } from './campaign-member-picker-view'
import { createMemberPickerStore } from './campaign-member-picker-store'

interface CampaignMemberPickerProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

// Stateful container — wires the framework-free campaign-member-picker-store
// to React via useSyncExternalStore. All search-debounce, pagination, and
// race-guard logic lives in the store (directly unit-tested there); this
// component only wires state to JSX (GH #103).
export function CampaignMemberPicker({ selectedIds, onChange }: CampaignMemberPickerProps) {
  const [store] = useState(() => createMemberPickerStore())
  const state = useSyncExternalStore(store.subscribe, store.getState)

  useEffect(() => {
    store.init()
    return () => store.destroy()
  }, [store])

  const toggle = (id: string) => onChange(
    selectedIds.includes(id) ? selectedIds.filter((sid) => sid !== id) : [...selectedIds, id]
  )

  return (
    <CampaignMemberPickerView
      members={state.members}
      total={state.total}
      loading={state.loading}
      loadingMore={state.loadingMore}
      hasMore={state.page < state.totalPages}
      error={state.error}
      search={state.search}
      selectedIds={selectedIds}
      onSearchChange={(value) => store.setSearch(value)}
      onToggle={toggle}
      onSelectAll={() => store.selectAll(selectedIds, onChange)}
      onDeselectAll={() => store.deselectAll(selectedIds, onChange)}
      onLoadMore={() => store.loadMore()}
    />
  )
}
