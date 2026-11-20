// WONB-001: tenant_onboarding_state repository (sole writer, service-role
// client). The mocks below mimic the supabase-js fluent builder pattern;
// they do not use a live database — RLS + trigger behaviour is exercised
// by the migration itself, not these tests.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  tenantOnboardingStateRepository,
  findByRestaurantId,
  insert,
  update,
  advance,
} from '../tenant-onboarding-state-repository'
import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import { ConcurrentAdvanceError } from '@/domain/services/__errors__/onboarding-errors'
import { buildInitialChecklist } from '@/domain/value-objects/pre-kickoff-checklist'

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>

beforeEach(() => vi.clearAllMocks())

interface SelectRecorder {
  table: string | null
  eqs: Array<{ col: string; val: unknown }>
}

function buildSelectClient(result: {
  data: unknown
  error: { message: string } | null
}): { client: SupabaseClient; recorder: SelectRecorder } {
  const recorder: SelectRecorder = { table: null, eqs: [] }
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eqChain: Record<string, unknown> = { maybeSingle }
  eqChain.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return eqChain
  })
  const select = vi.fn().mockReturnValue({
    eq: (col: string, val: unknown) => {
      recorder.eqs.push({ col, val })
      return eqChain
    },
  })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { select }
  })
  return { client: { from } as unknown as SupabaseClient, recorder }
}

interface InsertRecorder {
  table: string | null
  inserted: Record<string, unknown> | null
}

function buildInsertClient(error: { message: string } | null = null): {
  client: SupabaseClient
  recorder: InsertRecorder
} {
  const recorder: InsertRecorder = { table: null, inserted: null }
  const insertFn = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    recorder.inserted = row
    return Promise.resolve({ error })
  })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { insert: insertFn }
  })
  return { client: { from } as unknown as SupabaseClient, recorder }
}

interface UpdateRecorder {
  table: string | null
  updated: Record<string, unknown> | null
  eqs: Array<{ col: string; val: unknown }>
}

function buildUpdateClient(opts: {
  error?: { message: string } | null
  count?: number | null
}): { client: SupabaseClient; recorder: UpdateRecorder } {
  const recorder: UpdateRecorder = { table: null, updated: null, eqs: [] }
  const result = { error: opts.error ?? null, count: opts.count ?? 1 }
  // The supabase-js builder is both chainable (.eq returns the builder) and
  // thenable (awaiting any node executes the query). Mimic that by having
  // every node carry both `.eq` and `.then`.
  function makeChain(): Record<string, unknown> {
    const node: Record<string, unknown> = {}
    node.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      recorder.eqs.push({ col, val })
      return node
    })
    node.then = (resolve: (v: typeof result) => void) => resolve(result)
    return node
  }
  const updateFn = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    recorder.updated = row
    return makeChain()
  })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { update: updateFn }
  })
  return { client: { from } as unknown as SupabaseClient, recorder }
}

const NOW = '2026-05-04T10:00:00.000Z'

function defaultEntity(): TenantOnboardingState {
  return TenantOnboardingState.createDefault({
    id: 'tos-1',
    restaurantId: 'rest-1',
    now: NOW,
  })
}

describe('findByRestaurantId', () => {
  it('selects from tenant_onboarding_state filtered by restaurant_id', async () => {
    const row = {
      id: 'tos-1',
      restaurant_id: 'rest-1',
      onboarding_path: null,
      phase: 'setup',
      pre_kickoff_checklist: buildInitialChecklist(null),
      advanced_at: null,
      advanced_by: null,
      created_at: NOW,
      updated_at: NOW,
    }
    const { client, recorder } = buildSelectClient({ data: row, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findByRestaurantId('rest-1')

    expect(recorder.table).toBe('tenant_onboarding_state')
    expect(recorder.eqs).toEqual([{ col: 'restaurant_id', val: 'rest-1' }])
    expect(result?.snapshot.id).toBe('tos-1')
    expect(result?.snapshot.phase).toBe('setup')
  })

  it('returns null when no row exists for the tenant', async () => {
    const { client } = buildSelectClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    expect(await findByRestaurantId('rest-empty')).toBeNull()
  })

  it('throws contextually on db error', async () => {
    const { client } = buildSelectClient({
      data: null,
      error: { message: 'boom' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(findByRestaurantId('rest-1')).rejects.toThrow(
      /findByRestaurantId.*boom/
    )
  })
})

describe('insert', () => {
  it('inserts a row mapped to snake_case columns', async () => {
    const { client, recorder } = buildInsertClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await insert(defaultEntity())

    expect(recorder.table).toBe('tenant_onboarding_state')
    expect(recorder.inserted).toMatchObject({
      id: 'tos-1',
      restaurant_id: 'rest-1',
      onboarding_path: null,
      phase: 'setup',
    })
    // checklist persisted as JSONB
    expect(recorder.inserted?.pre_kickoff_checklist).toEqual(
      buildInitialChecklist(null)
    )
  })

  it('throws contextually when the insert errors', async () => {
    const { client } = buildInsertClient({ message: 'unique violation' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(insert(defaultEntity())).rejects.toThrow(
      /insert.*unique violation/
    )
  })
})

describe('update', () => {
  it('updates by id AND phase=expectedPhase with snake_case columns', async () => {
    const { client, recorder } = buildUpdateClient({ count: 1 })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const e = defaultEntity().setPath('A', NOW)
    await update(e, 'setup')

    expect(recorder.table).toBe('tenant_onboarding_state')
    expect(recorder.eqs).toEqual([
      { col: 'id', val: 'tos-1' },
      { col: 'phase', val: 'setup' },
    ])
    expect(recorder.updated).toMatchObject({
      onboarding_path: 'A',
      phase: 'setup',
    })
  })

  it('throws ConcurrentAdvanceError when 0 rows match (stale expectedPhase)', async () => {
    const { client } = buildUpdateClient({ count: 0 })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const e = defaultEntity().setPath('A', NOW)
    await expect(update(e, 'setup')).rejects.toBeInstanceOf(ConcurrentAdvanceError)
  })

  it('throws contextually on db error', async () => {
    const { client } = buildUpdateClient({ error: { message: 'boom' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(update(defaultEntity(), 'setup')).rejects.toThrow(/update.*boom/)
  })
})

describe('advance (optimistic concurrency)', () => {
  it('updates with WHERE id=$id AND phase=$expectedFrom and returns the entity on success', async () => {
    const { client, recorder } = buildUpdateClient({ count: 1 })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    let e = defaultEntity().setPath('A', NOW)
    for (const k of [
      'hk_sim_never_used',
      'verified_meta_business',
      'display_name_draft_approved',
      'opt_in_source_documented',
      'vertical_allowed',
      'first_three_campaigns_drafted',
    ] as const) {
      e = e.tickChecklist(k, 'auth-1', NOW)
    }
    e = e.advance({ kpiPass: true, expectedFrom: 'setup', actor: 'auth-1', now: NOW })

    const result = await advance(e, 'setup')

    expect(recorder.eqs).toEqual([
      { col: 'id', val: 'tos-1' },
      { col: 'phase', val: 'setup' },
    ])
    expect(recorder.updated).toMatchObject({ phase: 'probe' })
    expect(result.snapshot.phase).toBe('probe')
  })

  it('throws ConcurrentAdvanceError when 0 rows are affected', async () => {
    const { client } = buildUpdateClient({ count: 0 })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    let e = defaultEntity().setPath('A', NOW)
    for (const k of [
      'hk_sim_never_used',
      'verified_meta_business',
      'display_name_draft_approved',
      'opt_in_source_documented',
      'vertical_allowed',
      'first_three_campaigns_drafted',
    ] as const) {
      e = e.tickChecklist(k, 'auth-1', NOW)
    }
    e = e.advance({ kpiPass: true, expectedFrom: 'setup', actor: 'auth-1', now: NOW })

    await expect(advance(e, 'setup')).rejects.toBeInstanceOf(
      ConcurrentAdvanceError
    )
  })

  it('throws contextually on raw db error', async () => {
    const { client } = buildUpdateClient({ error: { message: 'boom' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    let e = defaultEntity().setPath('A', NOW)
    for (const k of [
      'hk_sim_never_used',
      'verified_meta_business',
      'display_name_draft_approved',
      'opt_in_source_documented',
      'vertical_allowed',
      'first_three_campaigns_drafted',
    ] as const) {
      e = e.tickChecklist(k, 'auth-1', NOW)
    }
    e = e.advance({ kpiPass: true, expectedFrom: 'setup', actor: 'auth-1', now: NOW })

    await expect(advance(e, 'setup')).rejects.toThrow(/advance.*boom/)
  })
})

describe('tenantOnboardingStateRepository contract lock', () => {
  it('exposes the four functions from the same module', () => {
    expect(tenantOnboardingStateRepository.findByRestaurantId).toBe(
      findByRestaurantId
    )
    expect(tenantOnboardingStateRepository.insert).toBe(insert)
    expect(tenantOnboardingStateRepository.update).toBe(update)
    expect(tenantOnboardingStateRepository.advance).toBe(advance)
  })
})
