'use client'

const selectClass = 'h-8 rounded-md border border-input bg-background px-3 text-sm'

interface WaTemplateFiltersProps {
  status: string
  category: string
  onStatusChange: (v: string) => void
  onCategoryChange: (v: string) => void
}

export function WaTemplateFilters({
  status, category, onStatusChange, onCategoryChange,
}: WaTemplateFiltersProps) {
  return (
    <div className="flex gap-3">
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className={selectClass}
      >
        <option value="">All Statuses</option>
        <option value="draft">Draft</option>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
        <option value="paused">Paused</option>
        <option value="disabled">Disabled</option>
      </select>
      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        className={selectClass}
      >
        <option value="">All Categories</option>
        <option value="MARKETING">Marketing</option>
        <option value="UTILITY">Utility</option>
      </select>
    </div>
  )
}
