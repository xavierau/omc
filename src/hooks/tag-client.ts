'use client'

// TAG-001 — Stream Bf: network helpers for the tag manager UI. The routes return
// the tag object directly on create (201) / rename (200), { tags } on list, and a
// 409 for a case-insensitively duplicate name. We surface `duplicate` so the form
// can show tags.duplicateName; every write is tenant-scoped server-side via
// getTenantContext(), so no ids are trusted from the client.

import type { Tag } from '@/domain/entities/tag'

const ENDPOINT = '/api/dashboard/tags'

export interface TagMutationResult {
  ok: boolean
  duplicate?: boolean
  tag?: Tag
}

export async function fetchTags(): Promise<Tag[]> {
  const res = await fetch(ENDPOINT)
  if (!res.ok) return []
  const json = await res.json().catch(() => ({}))
  return Array.isArray(json.tags) ? json.tags : []
}

export async function createTagRequest(name: string): Promise<TagMutationResult> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return toMutationResult(res)
}

export async function renameTagRequest(id: string, name: string): Promise<TagMutationResult> {
  const res = await fetch(`${ENDPOINT}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return toMutationResult(res)
}

export async function deleteTagRequest(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${ENDPOINT}/${id}`, { method: 'DELETE' })
  return { ok: res.ok }
}

async function toMutationResult(res: Response): Promise<TagMutationResult> {
  if (res.status === 409) return { ok: false, duplicate: true }
  if (!res.ok) return { ok: false }
  const tag = (await res.json().catch(() => undefined)) as Tag | undefined
  return { ok: true, tag }
}
