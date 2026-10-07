'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface Tag {
  id: string
  name: string
  color: string
}

interface TagComboboxProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  multiple?: boolean
  placeholder?: string
}

interface TagChipProps {
  tag: Tag
  selected: boolean
  onToggle: (id: string) => void
}

function TagChip({ tag, selected, onToggle }: TagChipProps) {
  return (
    <Badge asChild variant={selected ? 'default' : 'outline'}>
      <button type="button" onClick={() => onToggle(tag.id)}>
        <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
        {tag.name}
      </button>
    </Badge>
  )
}

export function TagCombobox({
  selectedIds,
  onChange,
  multiple = true,
  placeholder,
}: TagComboboxProps) {
  const t = useTranslations('tags')
  const tc = useTranslations('common')
  const [tags, setTags] = useState<Tag[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/tags')
      .then((res) => res.json())
      .then((data) => setTags(data.tags ?? []))
      .catch(() => setTags([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((tag) => tag.name.toLowerCase().includes(q))
  }, [tags, search])

  const toggle = (id: string) => {
    if (!multiple) {
      onChange(selectedIds.includes(id) ? [] : [id])
      return
    }
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((sid) => sid !== id)
        : [...selectedIds, id]
    )
  }

  if (loading) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>

  return (
    <div className="space-y-2">
      <Input
        placeholder={placeholder ?? t('placeholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {filtered.map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            selected={selectedIds.includes(tag.id)}
            onToggle={toggle}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        )}
      </div>
    </div>
  )
}
