import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/kapso/template-client')
// Keep the real `withTimeout`/`TimeoutError`/`describeDeployFailure` — only
// the Meta-calling functions are stubbed. Auto-mocking the whole module
// would replace `withTimeout` with a no-op `vi.fn()`, silently defeating
// the H1 timeout wrapping this suite exists to verify.
vi.mock('@/infrastructure/kapso/flow-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/infrastructure/kapso/flow-client')>()
  return {
    ...actual,
    deployContactFlow: vi.fn(),
    deprecateContactFlow: vi.fn(),
  }
})

import {
  getContactFlowId,
  getContactFlowIdStrict,
  updateContactFlowIdIfEmpty,
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveWabaId } from '@/infrastructure/kapso/template-client'
import { deployContactFlow, deprecateContactFlow } from '@/infrastructure/kapso/flow-client'
import {
  ensureContactFlowDeployed,
  resolveWaba,
  ENSURE_DEPLOYED_TIMEOUT_MS,
} from '../ensure-contact-flow-deployed'

const RESTAURANT_ID = 'rest-1'

describe('ensureContactFlowDeployed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(getContactFlowIdStrict).mockResolvedValue(null)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-1')
    vi.mocked(resolveWabaId).mockResolvedValue('derived-waba')
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)
    vi.mocked(deployContactFlow).mockResolvedValue({ ok: true, flowId: 'flow-new' })
    vi.mocked(updateContactFlowIdIfEmpty).mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is a no-op with zero Meta calls when a flow id already exists', async () => {
    vi.mocked(getContactFlowIdStrict).mockResolvedValue('flow-existing')

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(result).toEqual({ ok: true, flowId: 'flow-existing', created: false })
    expect(getRestaurantPhoneNumberId).not.toHaveBeenCalled()
    expect(resolveWabaId).not.toHaveBeenCalled()
    expect(getMetaBusinessAccountId).not.toHaveBeenCalled()
    expect(deployContactFlow).not.toHaveBeenCalled()
    expect(updateContactFlowIdIfEmpty).not.toHaveBeenCalled()
  })

  // H2: the idempotency guard must fail closed on a read error, never fall
  // through to "never deployed" — that would create a brand-new Meta flow
  // on every transient DB error (or a pre-059 database missing the column).
  it('returns ok:false without touching Meta when the strict idempotency read fails', async () => {
    vi.mocked(getContactFlowIdStrict).mockRejectedValue(new Error('column does not exist'))

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(result.ok).toBe(false)
    expect(resolveWabaId).not.toHaveBeenCalled()
    expect(deployContactFlow).not.toHaveBeenCalled()
  })

  it('uses the derived WABA even when it differs from the stored one, and warns', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue('derived-waba')
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('stored-waba')

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(deployContactFlow).toHaveBeenCalledWith('derived-waba')
    expect(result).toEqual({ ok: true, flowId: 'flow-new', created: true })
    expect(console.warn).toHaveBeenCalledWith(
      '[ContactFlow] contact_flow.waba_mismatch',
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        derived: 'derived-waba',
        stored: 'stored-waba',
      })
    )
  })

  // H3: derive-only. A stored value (possibly poisoned by
  // resubmit/route.ts's hardcoded foreign WABA, kanban:1300) must NEVER be
  // used as a fallback — that is exactly what let one transient Kapso blip
  // deploy a tenant's flow into a foreign WABA while reporting success.
  it('returns ok:false when derivation fails, even when a stored WABA exists — no cross-tenant fallback', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue(null)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('stored-waba')

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(result.ok).toBe(false)
    expect(deployContactFlow).not.toHaveBeenCalled()
    expect(updateContactFlowIdIfEmpty).not.toHaveBeenCalled()
  })

  it('returns ok:false when both derived and stored WABA are unavailable', async () => {
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('')
    vi.mocked(resolveWabaId).mockResolvedValue(null)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(result.ok).toBe(false)
    expect(deployContactFlow).not.toHaveBeenCalled()
    expect(updateContactFlowIdIfEmpty).not.toHaveBeenCalled()
  })

  it('persists the derived WABA only when the stored value is empty', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)

    await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(updateMetaBusinessAccountId).toHaveBeenCalledWith(RESTAURANT_ID, 'derived-waba')
  })

  it('never overwrites a non-empty stored WABA', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('stored-waba')

    await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(updateMetaBusinessAccountId).not.toHaveBeenCalled()
  })

  it('returns ok:false with structured validationErrors and does not persist when Meta rejects the Flow JSON', async () => {
    const validationErrors = [{ error: 'INVALID', message: 'bad thing' }]
    vi.mocked(deployContactFlow).mockResolvedValue({ ok: false, flowId: null, validationErrors })

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.validationErrors).toEqual(validationErrors)
    expect(updateContactFlowIdIfEmpty).not.toHaveBeenCalled()
  })

  it('persists the new flow id and reports created:true on success', async () => {
    vi.mocked(deployContactFlow).mockResolvedValue({ ok: true, flowId: 'flow-abc' })
    vi.mocked(updateContactFlowIdIfEmpty).mockResolvedValue(true)

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(updateContactFlowIdIfEmpty).toHaveBeenCalledWith(RESTAURANT_ID, 'flow-abc')
    expect(result).toEqual({ ok: true, flowId: 'flow-abc', created: true })
  })

  // M1: two concurrent deploys can't both "win" the persist.
  it('best-effort deprecates its own flow and reports the winning id when it loses the persist race', async () => {
    vi.mocked(deployContactFlow).mockResolvedValue({ ok: true, flowId: 'flow-loser' })
    vi.mocked(updateContactFlowIdIfEmpty).mockResolvedValue(false)
    vi.mocked(getContactFlowId).mockResolvedValue('flow-winner')

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(deprecateContactFlow).toHaveBeenCalledWith('flow-loser')
    expect(result).toEqual({ ok: true, flowId: 'flow-winner', created: false })
  })

  it('falls back to its own flow id when the post-race re-read comes up empty', async () => {
    vi.mocked(deployContactFlow).mockResolvedValue({ ok: true, flowId: 'flow-loser' })
    vi.mocked(updateContactFlowIdIfEmpty).mockResolvedValue(false)
    vi.mocked(getContactFlowId).mockResolvedValue(null)

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(result).toEqual({ ok: true, flowId: 'flow-loser', created: false })
  })

  it('returns ok:false, never throwing, when the deploy client unexpectedly throws', async () => {
    vi.mocked(deployContactFlow).mockRejectedValue(new Error('boom'))

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('boom')
  })

  it('returns ok:false without deploying when the Kapso API key is missing', async () => {
    vi.mocked(deployContactFlow).mockResolvedValue({
      ok: false,
      flowId: null,
      error: { title: 'kapso_no_api_key' },
    })

    const result = await ensureContactFlowDeployed(RESTAURANT_ID)

    expect(result.ok).toBe(false)
    expect(updateContactFlowIdIfEmpty).not.toHaveBeenCalled()
  })

  it('resolves (not rejects) with ok:false when the deploy client reports a timeout', async () => {
    vi.mocked(deployContactFlow).mockResolvedValue({
      ok: false,
      flowId: null,
      error: { title: 'flow_deploy_timeout' },
    })

    await expect(ensureContactFlowDeployed(RESTAURANT_ID)).resolves.toEqual(
      expect.objectContaining({ ok: false })
    )
  })

  // H1: the whole use-case is bounded, not just the deploy call — a stalled
  // WABA lookup (resolveWabaId's raw fetch has no timeout anywhere in the
  // SDK) must resolve to ok:false rather than hanging the admin's save.
  it('resolves to ok:false, not hanging, when the WABA lookup stalls past the outer timeout', async () => {
    vi.useFakeTimers()
    vi.mocked(resolveWabaId).mockImplementation(() => new Promise(() => {}))

    const pending = ensureContactFlowDeployed(RESTAURANT_ID)
    await vi.advanceTimersByTimeAsync(ENSURE_DEPLOYED_TIMEOUT_MS)
    const result = await pending

    expect(result.ok).toBe(false)
    expect(deployContactFlow).not.toHaveBeenCalled()
  })
})

describe('resolveWaba', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-1')
  })

  it('derives first and persists it when the stored value is empty', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue('derived-waba')
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)

    const result = await resolveWaba(RESTAURANT_ID)

    expect(result).toBe('derived-waba')
    expect(updateMetaBusinessAccountId).toHaveBeenCalledWith(RESTAURANT_ID, 'derived-waba')
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('uses the derived WABA and warns, without overwriting, when it differs from a non-empty stored value', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue('derived-waba')
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('stored-waba')

    const result = await resolveWaba(RESTAURANT_ID)

    expect(result).toBe('derived-waba')
    expect(updateMetaBusinessAccountId).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      '[ContactFlow] contact_flow.waba_mismatch',
      expect.objectContaining({ restaurantId: RESTAURANT_ID, derived: 'derived-waba', stored: 'stored-waba' })
    )
  })

  it('does not warn or persist when the derived and stored values already agree', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue('same-waba')
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('same-waba')

    const result = await resolveWaba(RESTAURANT_ID)

    expect(result).toBe('same-waba')
    expect(updateMetaBusinessAccountId).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
  })

  // H3: derive-only — no fallback to a (possibly poisoned) stored value.
  it('returns null without ever reading the stored value when derivation fails', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue(null)

    const result = await resolveWaba(RESTAURANT_ID)

    expect(result).toBeNull()
    expect(getMetaBusinessAccountId).not.toHaveBeenCalled()
    expect(updateMetaBusinessAccountId).not.toHaveBeenCalled()
  })

  it('treats an empty-string stored value the same as null (persists the derived value)', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue('derived-waba')
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('')

    const result = await resolveWaba(RESTAURANT_ID)

    expect(result).toBe('derived-waba')
    expect(updateMetaBusinessAccountId).toHaveBeenCalledWith(RESTAURANT_ID, 'derived-waba')
  })
})
