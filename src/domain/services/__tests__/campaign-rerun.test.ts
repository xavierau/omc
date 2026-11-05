import { describe, it, expect } from 'vitest'
import { rerunBlock } from '../campaign-rerun'
import {
  deliveryFailureReason,
  deliveryUnknownReason,
  isNoServiceWindowReason,
} from '../campaign-delivery-failure-reason'

const failed = (failureReason: string | null) => ({
  type: 'promo',
  status: 'failed',
  failureReason,
})

describe('rerunBlock (CAMP-014)', () => {
  it('a re-runnable failure has no block', () => {
    expect(rerunBlock(failed(deliveryFailureReason('131042', null, 'restricted')))).toBeNull()
  })

  it('the generic queue reason stays re-runnable: the row-evidence guard decides', () => {
    expect(rerunBlock(failed('Failed to send. Contact support if this persists.'))).toBeNull()
  })

  it('blocks welcome first, then a status that is not failed', () => {
    expect(rerunBlock({ ...failed(null), type: 'welcome' })).toBe('welcome')
    expect(rerunBlock({ ...failed(null), status: 'active' })).toBe('not_failed')
  })

  it('blocks delivery unknown', () => {
    expect(rerunBlock(failed(deliveryUnknownReason(5, 2)))).toBe('delivery_unknown')
  })

  it('blocks a 131047 failure, using the reason a real run stores', () => {
    expect(rerunBlock(failed(deliveryFailureReason('131047', 'Re-engagement message', null)))).toBe(
      'no_service_window'
    )
  })
})

describe('isNoServiceWindowReason (CAMP-014)', () => {
  it('recognises the stored 131047 wording only', () => {
    expect(isNoServiceWindowReason(deliveryFailureReason('131047', null, null))).toBe(true)
    expect(isNoServiceWindowReason(deliveryFailureReason('131042', null, null))).toBe(false)
    expect(isNoServiceWindowReason(deliveryFailureReason('131026', 'x', null))).toBe(false)
    expect(isNoServiceWindowReason(null)).toBe(false)
    expect(isNoServiceWindowReason(undefined)).toBe(false)
  })
})
