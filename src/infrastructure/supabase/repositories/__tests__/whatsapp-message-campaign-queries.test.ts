import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { fakeTable, type FakeRow } from '@/test-utils/fake-postgrest-table'
import {
  countCampaignBodyRows,
  countFailedBodyRowsWithoutMetaCode,
  countFailedCampaignQrImages,
  findLatestCampaignFailure,
} from '../whatsapp-message-campaign-queries'

function chainClient(result: Record<string, unknown>) {
  const select = vi.fn()
  const eq = vi.fn()
  const gte = vi.fn()
  const inFilter = vi.fn()
  const or = vi.fn()
  const chain: Record<string, unknown> = {
    select,
    eq,
    gte,
    in: inFilter,
    or,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  for (const fn of [select, eq, gte, inFilter, or]) fn.mockReturnValue(chain)
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from: () => chain } as never)
  return { select, eq, gte, inFilter, or }
}

describe('rerun evidence counts (CAMP-014)', () => {
  beforeEach(() => vi.clearAllMocks())
  const scope = { campaignId: 'c-1', restaurantId: 'r-1' }

  it('countCampaignBodyRows: exact head count of template and text rows for the tenant', async () => {
    const { select, eq, inFilter } = chainClient({ count: 250, error: null })

    await expect(countCampaignBodyRows(scope)).resolves.toBe(250)

    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(eq.mock.calls).toEqual([
      ['campaign_id', 'c-1'],
      ['restaurant_id', 'r-1'],
    ])
    expect(inFilter).toHaveBeenCalledWith('message_type', ['template', 'text'])
  })

  it('countFailedBodyRowsWithoutMetaCode: failed body rows whose error_code is not all digits', async () => {
    const { select, eq, inFilter, or } = chainClient({ count: 2, error: null })

    await expect(countFailedBodyRowsWithoutMetaCode(scope)).resolves.toBe(2)

    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(eq.mock.calls).toEqual([
      ['campaign_id', 'c-1'],
      ['restaurant_id', 'r-1'],
      ['status', 'failed'],
    ])
    expect(inFilter).toHaveBeenCalledWith('message_type', ['template', 'text'])
    expect(or).toHaveBeenCalledWith('error_code.is.null,error_code.not.match.^[0-9]+$')
  })

  describe('countFailedBodyRowsWithoutMetaCode over rows', () => {
    const row = (overrides: FakeRow = {}): FakeRow => ({
      campaign_id: 'c-1',
      restaurant_id: 'r-1',
      status: 'failed',
      message_type: 'template',
      error_code: '131042',
      ...overrides,
    })
    const countOver = (rows: FakeRow[]) => {
      vi.mocked(createServerSupabaseClient).mockReturnValue({ from: () => fakeTable(rows) } as never)
      return countFailedBodyRowsWithoutMetaCode(scope)
    }

    it.each([
      ['null', null],
      ['the sweep\'s internal_orphan', 'internal_orphan'],
      ['an invented internal code', 'some_new_code'],
      ['digits with a suffix', '131042x'],
      ['an empty string', ''],
    ])('refuses %s', async (_name, code) => {
      await expect(countOver([row(), row({ error_code: code })])).resolves.toBe(1)
    })

    it.each([['131042'], ['130472']])('passes Meta code %s', async (code) => {
      await expect(countOver([row({ error_code: code })])).resolves.toBe(0)
    })

    it('counts only failed body rows of this campaign', async () => {
      const unrelated = [
        row({ error_code: null, status: 'sent' }),
        row({ error_code: 'internal_orphan', message_type: 'image' }),
        row({ error_code: null, campaign_id: 'c-2' }),
        row({ error_code: null, restaurant_id: 'r-2' }),
      ]
      await expect(countOver(unrelated)).resolves.toBe(0)
    })
  })

  it.each([
    ['countCampaignBodyRows', countCampaignBodyRows],
    ['countFailedBodyRowsWithoutMetaCode', countFailedBodyRowsWithoutMetaCode],
  ])('%s throws on a query error, never reading it as zero', async (name, count) => {
    chainClient({ count: null, error: { message: 'db down' } })
    await expect(count(scope)).rejects.toThrow(`${name}: db down`)
  })
})

describe('countFailedCampaignQrImages (CAMP-014)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts failed image rows for the tenant with an exact head count, reading no rows', async () => {
    const { select, eq } = chainClient({ count: 7, error: null, data: null })

    const count = await countFailedCampaignQrImages({ campaignId: 'c-1', restaurantId: 'r-1' })

    expect(count).toBe(7)
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(eq.mock.calls).toEqual(
      expect.arrayContaining([
        ['campaign_id', 'c-1'],
        ['restaurant_id', 'r-1'],
        ['message_type', 'image'],
        ['status', 'failed'],
      ])
    )
  })

  it('applies queued_at >= the lower bound when one is given, so a re-run stops counting the earlier run', async () => {
    const { gte } = chainClient({ count: 1, error: null })

    await countFailedCampaignQrImages({
      campaignId: 'c-1',
      restaurantId: 'r-1',
      queuedSince: '2026-11-05T01:00:00Z',
    })

    expect(gte).toHaveBeenCalledWith('queued_at', '2026-11-05T01:00:00Z')
  })

  it.each([[null], [undefined]])('applies no lower bound for %s', async (queuedSince) => {
    const { gte } = chainClient({ count: 1, error: null })

    await countFailedCampaignQrImages({ campaignId: 'c-1', restaurantId: 'r-1', queuedSince })

    expect(gte).not.toHaveBeenCalled()
  })

  it('reads a null count as zero', async () => {
    chainClient({ count: null, error: null })
    await expect(
      countFailedCampaignQrImages({ campaignId: 'c-1', restaurantId: 'r-1' })
    ).resolves.toBe(0)
  })

  it('throws on a query error, so the list can degrade instead of reporting zero', async () => {
    chainClient({ count: null, error: { message: 'db down' } })
    await expect(
      countFailedCampaignQrImages({ campaignId: 'c-1', restaurantId: 'r-1' })
    ).rejects.toThrow('countFailedCampaignQrImages: db down')
  })
})

describe('findLatestCampaignFailure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the error details the reason is worded from (CAMP-014)', async () => {
    const { select } = chainClient({
      data: { error_code: '131042', error_title: 'T', error_details: 'payment has been restricted' },
      error: null,
    })

    await expect(findLatestCampaignFailure('c-1', 'r-1')).resolves.toEqual({
      errorCode: '131042',
      errorTitle: 'T',
      errorDetails: 'payment has been restricted',
    })
    expect(select).toHaveBeenCalledWith('error_code, error_title, error_details')
  })
})
