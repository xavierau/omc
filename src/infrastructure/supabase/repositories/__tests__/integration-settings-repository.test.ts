import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findIntegrationSettingsById,
  readOutboundSecret,
  setOutboundSecret,
  updateIntegrationInboundLimits,
  updateOutboundBreakerState,
} from '../integration-settings-repository'
import { encryptSecret } from '@/infrastructure/crypto/secret-box'

const ORIGINAL_KEY = process.env.INT001_SECRET_KEY

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INT001_SECRET_KEY = randomBytes(32).toString('base64')
})

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.INT001_SECRET_KEY
  else process.env.INT001_SECRET_KEY = ORIGINAL_KEY
})

function buildSelectClient(data: Record<string, unknown> | null) {
  const selectedCols: { value?: string } = {}
  const eqs: Array<{ col: string; val: unknown }> = []
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const eq = vi.fn().mockImplementation((col: string, val: unknown) => {
    eqs.push({ col, val })
    return { maybeSingle }
  })
  const select = vi.fn().mockImplementation((cols: string) => {
    selectedCols.value = cols
    return { eq }
  })
  const from = vi.fn().mockReturnValue({ select })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    selectedCols,
    eqs,
  }
}

describe('findIntegrationSettingsById (T-H1)', () => {
  it('NEVER selects outbound_secret_enc — the entity read path excludes it at the SQL level', async () => {
    const row = {
      integration_id: 'int-1',
      restaurant_id: 'r-1',
      new_join_template_id: null,
      consent_attestation_text: null,
      consent_attestation_ack_at: null,
      consent_attestation_ack_by: null,
      outbound_url: null,
      outbound_secret_last4: null,
      outbound_secret_updated_at: null,
      outbound_secret_updated_by: null,
      outbound_events: ['member.created'],
      outbound_enabled: false,
      outbound_pii_ack_at: null,
      outbound_pii_ack_by: null,
      outbound_status: 'active',
      outbound_failure_streak: 0,
      outbound_paused_at: null,
      inbound_rate_per_min: null,
      inbound_burst: null,
      inbound_queue_cap: null,
      inbound_secret_updated_at: null,
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
    }
    const { client, selectedCols, eqs } = buildSelectClient(row)
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findIntegrationSettingsById('int-1')

    expect(result?.snapshot.integrationId).toBe('int-1')
    expect(selectedCols.value).toBeDefined()
    expect(selectedCols.value).not.toContain('outbound_secret_enc')
    expect(eqs).toEqual([{ col: 'integration_id', val: 'int-1' }])
  })

  it('returns null when no row exists', async () => {
    const { client } = buildSelectClient(null)
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    expect(await findIntegrationSettingsById('int-missing')).toBeNull()
  })
})

describe('readOutboundSecret (T-H1)', () => {
  it('decrypts and returns the plaintext', async () => {
    const envelope = encryptSecret('my-webhook-secret')
    const { client } = buildSelectClient({ outbound_secret_enc: envelope })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    expect(await readOutboundSecret('int-1')).toBe('my-webhook-secret')
  })

  it('returns null when no secret is saved', async () => {
    const { client } = buildSelectClient({ outbound_secret_enc: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    expect(await readOutboundSecret('int-1')).toBeNull()
  })

  it('only ever selects outbound_secret_enc — no other row data crosses this call', async () => {
    const envelope = encryptSecret('x')
    const { client, selectedCols } = buildSelectClient({ outbound_secret_enc: envelope })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await readOutboundSecret('int-1')
    expect(selectedCols.value).toBe('outbound_secret_enc')
  })
})

describe('setOutboundSecret (T-H1)', () => {
  it('stores an encrypted envelope + last4 + audit stamp, returns last4 to display once', async () => {
    const updated: { value: Record<string, unknown> | null } = { value: null }
    const eq = vi.fn().mockResolvedValue({ data: null, error: null })
    const update = vi.fn().mockImplementation((row: Record<string, unknown>) => {
      updated.value = row
      return { eq }
    })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await setOutboundSecret({
      integrationId: 'int-1',
      plaintext: 'brand-new-secret-value',
      actorUserId: 'user-1',
    })

    expect(result.last4).toBe('alue')
    expect(updated.value?.outbound_secret_last4).toBe('alue')
    expect(updated.value?.outbound_secret_updated_by).toBe('user-1')
    expect(updated.value?.outbound_secret_enc).toEqual(expect.any(String))
    expect(updated.value?.outbound_secret_enc).not.toContain('brand-new-secret-value')
    expect(eq).toHaveBeenCalledWith('integration_id', 'int-1')
  })
})

describe('updateIntegrationInboundLimits (WI-2, admin route)', () => {
  it('writes only the provided fields plus updated_at', async () => {
    const updated: { value: Record<string, unknown> | null } = { value: null }
    const eq = vi.fn().mockResolvedValue({ data: null, error: null })
    const update = vi.fn().mockImplementation((row: Record<string, unknown>) => {
      updated.value = row
      return { eq }
    })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await updateIntegrationInboundLimits('int-1', { inboundRatePerMin: 120 })

    expect(updated.value?.inbound_rate_per_min).toBe(120)
    expect(updated.value?.inbound_burst).toBeUndefined()
    expect(updated.value?.inbound_queue_cap).toBeUndefined()
    expect(updated.value?.updated_at).toEqual(expect.any(String))
    expect(eq).toHaveBeenCalledWith('integration_id', 'int-1')
  })

  it('writes all three fields when all three are provided', async () => {
    const updated: { value: Record<string, unknown> | null } = { value: null }
    const eq = vi.fn().mockResolvedValue({ data: null, error: null })
    const update = vi.fn().mockImplementation((row: Record<string, unknown>) => {
      updated.value = row
      return { eq }
    })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await updateIntegrationInboundLimits('int-1', {
      inboundRatePerMin: 200,
      inboundBurst: 40,
      inboundQueueCap: 1000,
    })

    expect(updated.value).toMatchObject({
      inbound_rate_per_min: 200,
      inbound_burst: 40,
      inbound_queue_cap: 1000,
    })
  })

  it('throws on a Supabase error', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const update = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(updateIntegrationInboundLimits('int-1', { inboundBurst: 5 })).rejects.toThrow(/boom/)
  })
})

describe('updateOutboundBreakerState (WI-6)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes the streak alone when status/pausedAt are omitted', async () => {
    const updated: { value?: Record<string, unknown> } = {}
    const eq = vi.fn().mockResolvedValue({ data: null, error: null })
    const update = vi.fn().mockImplementation((row: Record<string, unknown>) => {
      updated.value = row
      return { eq }
    })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await updateOutboundBreakerState({ integrationId: 'int-1', outboundFailureStreak: 3 })

    expect(updated.value).toMatchObject({ outbound_failure_streak: 3 })
    expect(updated.value).not.toHaveProperty('outbound_status')
    expect(updated.value).not.toHaveProperty('outbound_paused_at')
  })

  it('writes status + pausedAt together when the breaker trips', async () => {
    const updated: { value?: Record<string, unknown> } = {}
    const eq = vi.fn().mockResolvedValue({ data: null, error: null })
    const update = vi.fn().mockImplementation((row: Record<string, unknown>) => {
      updated.value = row
      return { eq }
    })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await updateOutboundBreakerState({
      integrationId: 'int-1',
      outboundFailureStreak: 10,
      outboundStatus: 'paused_auto',
      outboundPausedAt: '2026-09-10T00:00:00.000Z',
    })

    expect(updated.value).toMatchObject({
      outbound_failure_streak: 10,
      outbound_status: 'paused_auto',
      outbound_paused_at: '2026-09-10T00:00:00.000Z',
    })
  })

  it('throws a contextual error on a database failure', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const update = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(
      updateOutboundBreakerState({ integrationId: 'int-1', outboundFailureStreak: 1 })
    ).rejects.toThrow(/updateOutboundBreakerState.*timeout/)
  })
})
