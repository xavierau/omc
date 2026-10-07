import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

// campaign-form-dialog.tsx is read-only for this work item (TAG-001 F3) —
// the edit-hydration logic under test (`d.tagIds ?? []` inside the
// campaign's useEffect) already exists and must not change. This repo runs
// vitest in a node env with no DOM/RTL/react-test-renderer, so the
// component can't be mounted to let its useEffect fire naturally. Instead,
// `useState`/`useEffect`/`useMemo` are replaced with plain, dispatcher-free
// stand-ins (same rationale as member-tags-section.test.tsx's `useState`
// mock): `useEffect` runs its callback synchronously and `useState`'s FIRST
// call (the `form` state) returns a spy setter whose calls we inspect —
// this exercises the dialog's real hydration code path directly.

const h = vi.hoisted(() => {
  let callIndex = 0
  const formSetter = vi.fn()
  const useState = (initial: unknown): [unknown, (v: unknown) => void] => {
    callIndex += 1
    // Call order in CampaignFormDialog: form, saving, error.
    if (callIndex === 1) return [initial, formSetter]
    return [initial, () => {}]
  }
  const useEffect = (fn: () => void) => {
    fn()
  }
  const useMemo = (fn: () => unknown) => fn()
  return {
    formSetter,
    useState,
    useEffect,
    useMemo,
    reset: () => {
      callIndex = 0
      formSetter.mockClear()
    },
  }
})

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: h.useState, useEffect: h.useEffect, useMemo: h.useMemo }
})

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { CampaignFormDialog } from '@/components/dashboard/campaign-form-dialog'

// Flushes the fetch().then().then() microtask chain the hydration effect
// kicks off.
async function tick(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function tagCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c-1',
    restaurantId: 'r-1',
    name: 'Loyal members',
    type: 'promo',
    template: '',
    templateEn: 'Hi there',
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'draft',
    failureReason: null,
    isChargeable: true,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: null,
    targetAudience: 'tag',
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

describe('CampaignFormDialog — tag-audience edit hydration (T-F3.7, A10)', () => {
  beforeEach(() => {
    h.reset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hydrates all of a campaign\'s tag ids from GET /campaigns/:id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: async () => ({ tagIds: ['tag-a', 'tag-b'] }) })
    )

    CampaignFormDialog({
      open: true,
      onOpenChange: () => {},
      onSuccess: () => {},
      campaign: tagCampaign(),
    } as never)

    await tick()

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/dashboard/campaigns/c-1')
    const lastCall = h.formSetter.mock.calls.at(-1)?.[0]
    expect(typeof lastCall).toBe('function')
    const next = (lastCall as (p: { tagIds: string[] }) => { tagIds: string[] })({
      tagIds: [],
    })
    expect(next.tagIds).toEqual(['tag-a', 'tag-b'])
  })

  it('hydrates an empty tagIds array when the campaign has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}) }))

    CampaignFormDialog({
      open: true,
      onOpenChange: () => {},
      onSuccess: () => {},
      campaign: tagCampaign(),
    } as never)

    await tick()

    const lastCall = h.formSetter.mock.calls.at(-1)?.[0]
    const next = (lastCall as (p: { tagIds: string[] }) => { tagIds: string[] })({
      tagIds: ['stale'],
    })
    expect(next.tagIds).toEqual([])
  })

  it('does not fetch tags for a non-tag-targeted campaign', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}) }))

    CampaignFormDialog({
      open: true,
      onOpenChange: () => {},
      onSuccess: () => {},
      campaign: tagCampaign({ targetAudience: 'all' }),
    } as never)

    await tick()

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
