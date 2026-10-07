import { describe, it, expect, vi, beforeEach } from 'vitest'
import { okResult } from '@/test-utils/send-result'

vi.mock('@/infrastructure/supabase/repositories/stamp-nudge-repository', () => ({
  getMemberNudgeState: vi.fn(),
  claimNudgeSlot: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/campaign-settings-repository', () => ({
  getSettingsForTenant: vi.fn(),
}))
vi.mock('@/application/check-marketing-cooldown', () => ({
  checkMarketingCooldown: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/conversation-window-repository', () => ({
  isWindowOpen: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
}))

import { maybeSendStampNudge } from '@/application/stamp-nudge'
import {
  getMemberNudgeState,
  claimNudgeSlot,
} from '@/infrastructure/supabase/repositories/stamp-nudge-repository'
import { getSettingsForTenant } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import { checkMarketingCooldown } from '@/application/check-marketing-cooldown'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'

const base = {
  restaurantId: 'r-1',
  memberId: 'm-1',
  cardId: 'card-1',
  stampsCount: 9,
  stampsRequired: 10,
}

function settings(cap: number) {
  return { restaurantId: 'r-1', perUserMarketingCap: cap } as unknown as Awaited<
    ReturnType<typeof getSettingsForTenant>
  >
}

describe('maybeSendStampNudge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMemberNudgeState).mockResolvedValue({
      phone: '85291234567',
      preferredLanguage: 'en',
      pmmThrottledUntil: null,
      unreachableAt: null,
    })
    vi.mocked(claimNudgeSlot).mockResolvedValue(true)
    vi.mocked(getSettingsForTenant).mockResolvedValue(settings(3))
    vi.mocked(checkMarketingCooldown).mockResolvedValue({ allowed: true })
    vi.mocked(isWindowOpen).mockResolvedValue(true)
    vi.mocked(sendTextMessage).mockResolvedValue(okResult())
  })

  it('does NOT fire when the stamp is not the last-before-reward', async () => {
    await maybeSendStampNudge({ ...base, stampsCount: 7, phoneNumberId: 'pn' })
    expect(claimNudgeSlot).not.toHaveBeenCalled()
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('sends a free-form "X to go" nudge in an open window when allowed', async () => {
    await maybeSendStampNudge({ ...base, phoneNumberId: 'pn' })

    expect(claimNudgeSlot).toHaveBeenCalledWith('card-1')
    expect(checkMarketingCooldown).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberPmmThrottledUntil: null,
      memberUnreachableAt: null,
      cap: 3,
    })
    expect(sendTextMessage).toHaveBeenCalledTimes(1)
    const [, , body] = vi.mocked(sendTextMessage).mock.calls[0]
    expect(body).toContain('1') // 1 to go
  })

  it('claims the slot atomically before sending (no double-send)', async () => {
    vi.mocked(claimNudgeSlot).mockResolvedValue(false) // slot already taken
    await maybeSendStampNudge({ ...base, phoneNumberId: 'pn' })
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('does NOT burn the once-per-card slot when the cooldown gate denies', async () => {
    // The claim must be the final gate (after cooldown + window pass) so a
    // transient cap suppression can still be re-attempted on a later trigger.
    vi.mocked(checkMarketingCooldown).mockResolvedValue({
      allowed: false,
      reason: 'cap_exceeded',
    })
    await maybeSendStampNudge({ ...base, phoneNumberId: 'pn' })
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(claimNudgeSlot).not.toHaveBeenCalled()
  })

  it('SUPPRESSES when pmm_throttled', async () => {
    vi.mocked(getMemberNudgeState).mockResolvedValue({
      phone: '85291234567',
      preferredLanguage: 'en',
      pmmThrottledUntil: '2999-01-01T00:00:00.000Z',
      unreachableAt: null,
    })
    vi.mocked(checkMarketingCooldown).mockResolvedValue({
      allowed: false,
      reason: 'pmm_throttled',
    })
    await maybeSendStampNudge({ ...base, phoneNumberId: 'pn' })
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('SUPPRESSES when there is no open window (no approved template path in MVP)', async () => {
    vi.mocked(isWindowOpen).mockResolvedValue(false)
    await maybeSendStampNudge({ ...base, phoneNumberId: 'pn' })
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('passes the member quality flags into the cooldown gate', async () => {
    vi.mocked(getMemberNudgeState).mockResolvedValue({
      phone: '85291234567',
      preferredLanguage: 'en',
      pmmThrottledUntil: '2030-01-01T00:00:00.000Z',
      unreachableAt: '2026-01-01T00:00:00.000Z',
    })
    vi.mocked(checkMarketingCooldown).mockResolvedValue({ allowed: true })
    await maybeSendStampNudge({ ...base, phoneNumberId: 'pn' })
    expect(checkMarketingCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        memberPmmThrottledUntil: '2030-01-01T00:00:00.000Z',
        memberUnreachableAt: '2026-01-01T00:00:00.000Z',
      })
    )
  })

  it('does nothing when the member cannot be loaded', async () => {
    vi.mocked(getMemberNudgeState).mockResolvedValue(null)
    await maybeSendStampNudge({ ...base, phoneNumberId: 'pn' })
    expect(claimNudgeSlot).not.toHaveBeenCalled()
    expect(sendTextMessage).not.toHaveBeenCalled()
  })
})
