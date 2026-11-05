'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTenant } from '@/hooks/use-tenant'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

/**
 * The table/editor's view of a template row, derived from the entity so the
 * two cannot drift. rejectionReason stays optional for row fixtures.
 */
export type WaTemplate = Pick<
  WhatsAppTemplate,
  'id' | 'name' | 'language' | 'category' | 'status' | 'components' | 'createdAt'
> & { rejectionReason?: string | null }

interface Filters {
  status?: string
  category?: string
}

interface Options {
  /** false = do not fetch (e.g. the campaign form while inline text is chosen). Default true. */
  enabled?: boolean
}

const ENDPOINT = '/api/dashboard/wa-templates'
const EMPTY_LIST: WhatsAppTemplate[] = []

/** key = tenant + url, so a tenant switch never shows the previous tenant's rows. */
export interface RequestTarget {
  key: string
  url: string
}

export interface RequestState<T> {
  key: string | null
  data: T
  isLoading: boolean
  error: string | null
}

type Fetcher<T> = (url: string, signal: AbortSignal) => Promise<T>

// Framework-free like createTagRecipientCountStore: no React renderer in this repo,
// so abort + stale-response + failure handling is unit-tested here directly.
export function createRequestStore<T>(fetcher: Fetcher<T>, empty: T) {
  let state: RequestState<T> = { key: null, data: empty, isLoading: false, error: null }
  let controller: AbortController | null = null
  let generation = 0
  const listeners = new Set<() => void>()

  function setState(next: RequestState<T>) {
    state = next
    listeners.forEach((listener) => listener())
  }

  function cancel(): number {
    controller?.abort()
    controller = null
    generation += 1
    return generation
  }

  function load(target: RequestTarget | null) {
    const gen = cancel()
    if (!target) return setState({ key: null, data: empty, isLoading: false, error: null })
    const ac = new AbortController()
    controller = ac
    // Same key = refetch: keep the rows on screen; a new key never shows the old one's.
    const data = target.key === state.key ? state.data : empty
    setState({ key: target.key, data, isLoading: true, error: null })
    fetcher(target.url, ac.signal).then(
      (result) => gen === generation && setState({ key: target.key, data: result, isLoading: false, error: null }),
      (err) => gen === generation && setState({ key: target.key, data: empty, isLoading: false, error: messageOf(err) })
    )
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    load,
    destroy: () => {
      cancel()
    },
  }
}

/** The hook's answer for the current target; a target the store has not started yet counts as loading. */
export function viewRequest<T>(state: RequestState<T>, target: RequestTarget | null, empty: T) {
  if (!target) return { data: empty, isLoading: false, error: null }
  if (state.key !== target.key) return { data: empty, isLoading: true, error: null }
  return { data: state.data, isLoading: state.isLoading, error: state.error }
}

export function templateListTarget(
  restaurantId: string | null,
  filters: Filters | undefined,
  enabled: boolean
): RequestTarget | null {
  if (!restaurantId || !enabled) return null
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.category) params.set('category', filters.category)
  const qs = params.toString()
  const url = `${ENDPOINT}${qs ? `?${qs}` : ''}`
  return { key: `${restaurantId}|${url}`, url }
}

export function singleTemplateTarget(restaurantId: string | null, id: string | null): RequestTarget | null {
  if (!restaurantId || !id) return null
  const url = `${ENDPOINT}/${encodeURIComponent(id)}`
  return { key: `${restaurantId}|${url}`, url }
}

// The one parse point: both routes serialise WhatsAppTemplate entities
// (ListTemplatesResult, findTemplateByIdForRestaurant). Rows that fail this
// shape check are dropped; past here the entity type is trusted.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTemplate(value: unknown): value is WhatsAppTemplate {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && Array.isArray(value.components)
}

export function parseTemplateList(json: unknown): WhatsAppTemplate[] {
  const list = isRecord(json) ? json.templates : undefined
  return Array.isArray(list) ? list.filter(isTemplate) : []
}

export function parseTemplate(json: unknown): WhatsAppTemplate {
  if (!isTemplate(json)) throw new Error('Malformed template response')
  return json
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Failed to fetch templates (${res.status})`)
  return res.json()
}

const fetchTemplateList: Fetcher<WhatsAppTemplate[]> = async (url, signal) =>
  parseTemplateList(await fetchJson(url, signal))

const fetchTemplate: Fetcher<WhatsAppTemplate | null> = async (url, signal) =>
  parseTemplate(await fetchJson(url, signal))

function useRequest<T>(target: RequestTarget | null, fetcher: Fetcher<T>, empty: T) {
  const [store] = useState(() => createRequestStore(fetcher, empty))
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const key = target?.key ?? null
  const url = target?.url ?? null

  useEffect(() => {
    store.load(key !== null && url !== null ? { key, url } : null)
  }, [store, key, url])

  useEffect(() => () => store.destroy(), [store])

  const refetch = () => store.load(target)
  return { ...viewRequest(state, target, empty), refetch }
}

export function useWaTemplates(filters?: Filters, options: Options = {}) {
  const { restaurantId } = useTenant()
  const target = templateListTarget(restaurantId, filters, options.enabled ?? true)
  const { data, isLoading, error, refetch } = useRequest(target, fetchTemplateList, EMPTY_LIST)
  return { templates: data, isLoading, error, refetch }
}

/** One template via GET /api/dashboard/wa-templates/[id]; id null = no fetch. */
export function useWaTemplate(id: string | null) {
  const { restaurantId } = useTenant()
  const target = singleTemplateTarget(restaurantId, id)
  const { data, isLoading, error } = useRequest(target, fetchTemplate, null)
  return { template: data, isLoading, error }
}

export async function syncTemplates(): Promise<void> {
  const res = await fetch('/api/dashboard/wa-templates/sync', { method: 'POST' })
  if (!res.ok) throw new Error('Sync failed')
}
