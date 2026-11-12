import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-quality-state', () => ({
  clearMemberUnreachable: vi.fn(),
}))
vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

import { restoreMemberReachability } from '@/application/restore-member-reachability'
import { clearMemberUnreachable } from '@/infrastructure/supabase/repositories/member-quality-state'
import { emitEvent } from '@/application/emit-event'

const args = { restaurantId: 'r-1', phoneE164: '+85291234567', messageType: 'text' }

describe('restoreMemberReachability (MEM-004)', () => {
  const log = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(emitEvent).mockResolvedValue('evt-1')
  })

  it('clears unreachable_at and emits reachability_restored with member id + message type', async () => {
    vi.mocked(clearMemberUnreachable).mockResolvedValue({
      memberId: 'm-1',
    })

    const restored = await restoreMemberReachability(args, log)

    expect(restored).toBe(true)
    expect(clearMemberUnreachable).toHaveBeenCalledWith('r-1', '+85291234567')
    expect(emitEvent).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: 'm-1',
      type: 'reachability_restored',
      dataJson: { member_id: 'm-1', trigger_message_type: 'text' },
    })
  })

  it('does not emit an event when nothing was cleared (unknown phone / already reachable)', async () => {
    vi.mocked(clearMemberUnreachable).mockResolvedValue(null)

    const restored = await restoreMemberReachability(args, log)

    expect(restored).toBe(false)
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('swallows a repository failure with a warn', async () => {
    vi.mocked(clearMemberUnreachable).mockRejectedValue(new Error('db down'))

    await expect(restoreMemberReachability(args, log)).resolves.toBe(false)

    expect(emitEvent).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('warn', 'reachability.restore_failed', expect.anything())
  })

  it('swallows an event failure (e.g. 081 not applied) with a warn; the clear stands', async () => {
    vi.mocked(clearMemberUnreachable).mockResolvedValue({
      memberId: 'm-1',
    })
    vi.mocked(emitEvent).mockRejectedValue(new Error('events_type_check violation'))

    await expect(restoreMemberReachability(args, log)).resolves.toBe(true)

    expect(log).toHaveBeenCalledWith('warn', 'reachability.event_failed', expect.anything())
  })
})
