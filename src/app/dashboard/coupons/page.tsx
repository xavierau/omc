'use client'

import { useState, useCallback } from 'react'
import { useCoupons } from '@/hooks/use-coupons'
import { CouponTable } from '@/components/dashboard/coupon-table'
import { CouponFormDialog } from '@/components/dashboard/coupon-form-dialog'
import { CouponDetailPanel } from '@/components/dashboard/coupon-detail-panel'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import type { CouponListItem } from '@/hooks/use-coupons'

export default function CouponsPage() {
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selectedCouponId, setSelectedCouponId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editCoupon, setEditCoupon] = useState<CouponListItem | null>(null)

  const { data, isLoading, error, refetch } = useCoupons({ type: typeFilter, active: activeFilter, page })

  const handleSelectCoupon = (id: string) => {
    setSelectedCouponId(id)
    setDetailOpen(true)
  }

  const handleToggleActive = useCallback(async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/dashboard/coupons/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive }),
      })
      if (!res.ok) throw new Error('Failed to toggle')
      refetch()
    } catch { /* swallow */ }
  }, [refetch])

  const handleCreate = () => { setEditCoupon(null); setFormOpen(true) }

  const filteredCoupons = data?.coupons.filter(
    (c) => !search || c.code.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Couldn&apos;t load coupons.</p>
        <Button variant="outline" onClick={refetch} className="mt-4">Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <CouponsHeader
        activeFilter={activeFilter}
        onActiveFilterChange={setActiveFilter}
        onCreate={handleCreate}
      />
      <CouponsContent
        coupons={filteredCoupons}
        isLoading={isLoading}
        search={search}
        onSearchChange={setSearch}
        typeFilter={typeFilter}
        onTypeFilterChange={(v) => { setTypeFilter(v); setPage(1) }}
        onSelectCoupon={handleSelectCoupon}
        onToggleActive={handleToggleActive}
      />
      {data && data.totalPages > 1 && (
        <Pagination data={data} page={page} onPageChange={setPage} />
      )}
      <CouponFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSaved={refetch} coupon={editCoupon} />
      <CouponDetailPanel couponId={selectedCouponId} open={detailOpen} onClose={() => setDetailOpen(false)} />
    </div>
  )
}

function CouponsHeader({ activeFilter, onActiveFilterChange, onCreate }: {
  activeFilter: string; onActiveFilterChange: (v: string) => void; onCreate: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold text-foreground">Coupons</h1>
      <div className="flex gap-2">
        <select value={activeFilter} onChange={(e) => onActiveFilterChange(e.target.value)} className="h-8 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">All Status</option><option value="true">Active Only</option><option value="false">Inactive Only</option>
        </select>
        <Button onClick={onCreate}>Create Coupon</Button>
      </div>
    </div>
  )
}

function CouponsContent({ coupons, isLoading, search, onSearchChange, typeFilter, onTypeFilterChange, onSelectCoupon, onToggleActive }: {
  coupons: CouponListItem[]
  isLoading: boolean
  search: string
  onSearchChange: (v: string) => void
  typeFilter: string
  onTypeFilterChange: (v: string) => void
  onSelectCoupon: (id: string) => void
  onToggleActive: (id: string, isActive: boolean) => void
}) {
  if (isLoading) return <LoadingSkeleton />
  if (coupons.length === 0 && !search && !typeFilter) {
    return <EmptyState title="No coupons yet" description="Create your first coupon to get started." />
  }
  if (coupons.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">No coupons match your filters</div>
  }
  return (
    <CouponTable
      coupons={coupons}
      search={search}
      onSearchChange={onSearchChange}
      typeFilter={typeFilter}
      onTypeFilterChange={onTypeFilterChange}
      onSelectCoupon={onSelectCoupon}
      onToggleActive={onToggleActive}
    />
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />)}
    </div>
  )
}

function Pagination({ data, page, onPageChange }: {
  data: { total: number; page: number; pageSize: number; totalPages: number }; page: number; onPageChange: (p: number) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Showing {(data.page - 1) * data.pageSize + 1}&ndash;{Math.min(data.page * data.pageSize, data.total)} of {data.total}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => onPageChange(page + 1)}>Next</Button>
      </div>
    </div>
  )
}
