import { describe, it, expect } from 'vitest'
import type { MemberOutcome } from '../execute-campaign-batch-counters'
import { emptyCounters, tally } from '../execute-campaign-batch-counters'
import { SendFailedError } from '../send-failed-error'

// #127 / CAMP-007: `finalizeCampaignRun` decides completed vs failed from
// these counters, so the tally itself gets a direct unit pin — a wrongly
// reset or miscounted `sent` would misclassify a partial run as all-failed,
// and a bookkeeping crash counted as `failed` would let a DELIVERED run be
// terminally marked "all sends failed" (revival = duplicate blast).
describe('tally', () => {
  const fulfilled = (value: MemberOutcome) =>
    ({ status: 'fulfilled', value }) as PromiseFulfilledResult<MemberOutcome>

  it('counts sent, failed, errored, and each skip reason', () => {
    const counters = emptyCounters()
    tally(
      [
        fulfilled('sent'),
        { status: 'rejected', reason: new SendFailedError('campaign', 'kapso_send_error') },
        { status: 'rejected', reason: new Error('increment RPC blew up') },
        fulfilled('skipped_no_consent'),
        fulfilled('skipped_cap_exceeded'),
        fulfilled('skipped_throttled'),
        fulfilled('skipped_unreachable'),
      ],
      counters
    )
    expect(counters).toEqual({
      sent: 1,
      failed: 1,
      errored: 1,
      noConsent: 1,
      capExceeded: 1,
      throttled: 1,
      unreachable: 1,
    })
  })

  it('counts ONLY SendFailedError as failed — other rejections are errored', () => {
    const counters = emptyCounters()
    tally(
      [
        { status: 'rejected', reason: new Error('emitEvent crashed post-send') },
        { status: 'rejected', reason: 'not even an Error' },
      ],
      counters
    )
    expect(counters.failed).toBe(0)
    expect(counters.errored).toBe(2)
  })

  it('accumulates across multiple calls (sub-batches) without resetting', () => {
    const counters = emptyCounters()
    tally([fulfilled('sent')], counters)
    tally(
      [{ status: 'rejected', reason: new SendFailedError('campaign', 'x') }],
      counters
    )
    tally([fulfilled('sent')], counters)
    expect(counters.sent).toBe(2)
    expect(counters.failed).toBe(1)
  })
})
