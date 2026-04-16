'use client'

import { useTranslations } from 'next-intl'

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
  const t = useTranslations('waTemplates')

  return (
    <div className="flex gap-3">
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className={selectClass}
      >
        <option value="">{t('allStatuses')}</option>
        <option value="draft">{t('draft')}</option>
        <option value="pending">{t('pending')}</option>
        <option value="approved">{t('approved')}</option>
        <option value="rejected">{t('rejected')}</option>
        <option value="paused">{t('paused')}</option>
        <option value="disabled">{t('disabled')}</option>
      </select>
      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        className={selectClass}
      >
        <option value="">{t('allCategories')}</option>
        <option value="MARKETING">{t('marketing')}</option>
        <option value="UTILITY">{t('utility')}</option>
      </select>
    </div>
  )
}
