import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-create-repository', () => ({
  insertMember: vi.fn(),
}))

// WI-6: the seam's default publisher is now the REAL `emitIntegrationEvent`
// adapter (previously a no-op) -- mocked here at its own module boundary so
// the "no injected publisher" test below stays a pure unit test (no
// Supabase/Redis) while still proving the seam reaches the real adapter,
// not a stub. `vi.hoisted` per the repo's own campaign-queue.test.ts
// precedent: the mock factory below runs before this file's imports are
// evaluated, so the spy it returns must exist before that point.
const { emitIntegrationEventMock } = vi.hoisted(() => ({
  emitIntegrationEventMock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/application/emit-integration-event', () => ({
  emitIntegrationEvent: emitIntegrationEventMock,
  getIntegrationEventPublisher: () => ({ publish: emitIntegrationEventMock }),
}))

import { insertMember } from '@/infrastructure/supabase/repositories/member-create-repository'
import { createOrGetMember } from '../create-or-get-member'
import { E164Phone } from '@/domain/value-objects/e164-phone'
import { RecordingPublisher } from '@/test-utils/recording-publisher'

describe('createOrGetMember (INT-001 T-H6 seam)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('created: calls insertMember with the mapped E164 value and publishes member.created', async () => {
    vi.mocked(insertMember).mockResolvedValue({
      outcome: 'created',
      memberId: 'm-1',
      status: 'active',
    })
    const publisher = new RecordingPublisher()

    const result = await createOrGetMember(
      {
        restaurantId: 'r-1',
        phoneE164: E164Phone.of('+85298765432'),
        name: 'Ada',
        preferredLanguage: 'en',
        source: 'partner_api',
        originIntegrationId: 'int-1',
      },
      { publisher }
    )

    expect(result).toEqual({ outcome: 'created', memberId: 'm-1', status: 'active' })
    expect(insertMember).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '+85298765432',
      name: 'Ada',
      preferredLanguage: 'en',
    })
    expect(publisher.events).toHaveLength(1)
    expect(publisher.events[0]).toMatchObject({
      restaurantId: 'r-1',
      memberId: 'm-1',
      type: 'member.created',
      originIntegrationId: 'int-1',
      // WI-6: source threaded through from CreateOrGetMemberInput.source so
      // build-outbound-payload.ts can populate the outbound wire payload's
      // required data.source field.
      source: 'partner_api',
    })
  })

  it('existing: does NOT publish member.created', async () => {
    vi.mocked(insertMember).mockResolvedValue({
      outcome: 'existing',
      memberId: 'm-2',
      status: 'active',
    })
    const publisher = new RecordingPublisher()

    const result = await createOrGetMember(
      {
        restaurantId: 'r-1',
        phoneE164: E164Phone.of('+85298765432'),
        name: null,
        preferredLanguage: null,
        source: 'partner_api',
      },
      { publisher }
    )

    expect(result.outcome).toBe('existing')
    expect(publisher.events).toHaveLength(0)
  })

  it('existing + unsubscribed: passes the status through untouched (OD-2(b))', async () => {
    vi.mocked(insertMember).mockResolvedValue({
      outcome: 'existing',
      memberId: 'm-3',
      status: 'unsubscribed',
    })

    const result = await createOrGetMember({
      restaurantId: 'r-1',
      phoneE164: E164Phone.of('+85298765432'),
      name: null,
      preferredLanguage: null,
      source: 'partner_api',
    })

    expect(result).toEqual({ outcome: 'existing', memberId: 'm-3', status: 'unsubscribed' })
  })

  it('without an injected publisher, falls back to the real emitIntegrationEvent adapter (WI-6 -- was a no-op under WI-1)', async () => {
    vi.mocked(insertMember).mockResolvedValue({
      outcome: 'created',
      memberId: 'm-4',
      status: 'active',
    })

    await expect(
      createOrGetMember({
        restaurantId: 'r-1',
        phoneE164: E164Phone.of('+85298765432'),
        name: null,
        preferredLanguage: null,
        source: 'whatsapp_join_keyword',
      })
    ).resolves.toEqual({ outcome: 'created', memberId: 'm-4', status: 'active' })

    expect(emitIntegrationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-4', type: 'member.created', source: 'whatsapp_join_keyword' })
    )
  })

  it('omitting originIntegrationId publishes with originIntegrationId: null', async () => {
    vi.mocked(insertMember).mockResolvedValue({
      outcome: 'created',
      memberId: 'm-5',
      status: 'active',
    })
    const publisher = new RecordingPublisher()

    await createOrGetMember(
      {
        restaurantId: 'r-1',
        phoneE164: E164Phone.of('+85298765432'),
        name: null,
        preferredLanguage: null,
        source: 'web',
      },
      { publisher }
    )

    expect(publisher.events[0].originIntegrationId).toBeNull()
  })
})
