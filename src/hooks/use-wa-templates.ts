'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'

export interface WaTemplate {
  id: string
  name: string
  language: string
  category: string
  status: string
  components: Record<string, unknown>[]
  createdAt: string
}

interface Filters {
  status?: string
  category?: string
}

export function useWaTemplates(filters?: Filters) {
  const { restaurantId } = useTenant()
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    if (!restaurantId) return
    try {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams()
      if (filters?.status) params.set('status', filters.status)
      if (filters?.category) params.set('category', filters.category)
      const qs = params.toString()
      const url = `/api/dashboard/wa-templates${qs ? `?${qs}` : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch templates')
      const json = await res.json()
      setTemplates(json.templates ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [filters?.status, filters?.category, restaurantId])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  return { templates, isLoading, error, refetch: fetchTemplates }
}

export async function syncTemplates(): Promise<void> {
  const res = await fetch('/api/dashboard/wa-templates/sync', { method: 'POST' })
  if (!res.ok) throw new Error('Sync failed')
}
