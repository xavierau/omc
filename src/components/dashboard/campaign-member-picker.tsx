'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Member {
  id: string
  name: string | null
  phone: string
}

interface CampaignMemberPickerProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function CampaignMemberPicker({ selectedIds, onChange }: CampaignMemberPickerProps) {
  const t = useTranslations('campaigns')
  const tc = useTranslations('common')
  const [members, setMembers] = useState<Member[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/members')
      .then((res) => res.json())
      .then((data) => setMembers(data.members ?? []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(
      (m) =>
        (m.name ?? '').toLowerCase().includes(q) ||
        m.phone.includes(q)
    )
  }, [members, search])

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((sid) => sid !== id)
        : [...selectedIds, id]
    )
  }

  const selectAll = () => onChange(filtered.map((m) => m.id))
  const deselectAll = () => onChange([])

  if (loading) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>

  return (
    <div className="space-y-2">
      <Input
        placeholder={t('searchMembers')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t('selectedCount', { count: selectedIds.length })}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={selectAll}>
            {t('selectAll')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={deselectAll}>
            {t('deselectAll')}
          </Button>
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
        {filtered.map((m) => (
          <label key={m.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={selectedIds.includes(m.id)}
              onChange={() => toggle(m.id)}
            />
            <span className="font-medium">{m.name ?? tc('unknown')}</span>
            <span className="text-muted-foreground ml-auto">{m.phone}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground p-3">{t('noMatch')}</p>
        )}
      </div>
    </div>
  )
}
