import { describe, it, expect } from 'vitest'
import { shouldPromptOptin } from '../should-prompt-optin'
import { ConsentRecord } from '@/domain/entities/consent-record'

const MEMBER = { id: 'm-1' } as const
const NOW = new Date('2026-05-04T10:00:00.000Z')

function pendingCapturedAt(at: Date): ConsentRecord {
  const r = ConsentRecord.markPending({
    id: 'c-pending',
    restaurantId: 'r-1',
    memberId: 'm-1',
    phoneE164: '85291111111',
    category: 'marketing',
    source: 'inbound_first_optin',
  })
  return ConsentRecord.fromProps({
    ...r.snapshot,
    capturedAt: at.toISOString(),
  })
}

function optedIn(grade: 'strong' | 'weak'): ConsentRecord {
  return ConsentRecord.grant({
    id: 'c-opted',
    restaurantId: 'r-1',
    memberId: 'm-1',
    phoneE164: '85291111111',
    category: 'marketing',
    source: 'website_form',
    grade,
  })
}

function optedOut(): ConsentRecord {
  return optedIn('strong').revoke(new Date('2026-04-01T00:00:00.000Z'))
}

describe('shouldPromptOptin', () => {
  it('skips when message is a recognised system keyword', () => {
    expect(
      shouldPromptOptin({
        existingMember: MEMBER,
        activeMarketingConsent: null,
        recentPendingConsent: null,
        isSystemKeyword: true,
        now: NOW,
      })
    ).toEqual({ prompt: false, reason: 'system_keyword' })
  })

  it('skips when no member exists (existing JOIN flow handles new members)', () => {
    expect(
      shouldPromptOptin({
        existingMember: null,
        activeMarketingConsent: null,
        recentPendingConsent: null,
        isSystemKeyword: false,
        now: NOW,
      })
    ).toEqual({ prompt: false, reason: 'no_member' })
  })

  it('skips when an opted_in strong consent already exists', () => {
    expect(
      shouldPromptOptin({
        existingMember: MEMBER,
        activeMarketingConsent: optedIn('strong'),
        recentPendingConsent: null,
        isSystemKeyword: false,
        now: NOW,
      })
    ).toEqual({ prompt: false, reason: 'has_strong_consent' })
  })

  it('still prompts when only a non-strong opted_in record exists (re-confirmation path)', () => {
    expect(
      shouldPromptOptin({
        existingMember: MEMBER,
        activeMarketingConsent: optedIn('weak'),
        recentPendingConsent: null,
        isSystemKeyword: false,
        now: NOW,
      })
    ).toEqual({ prompt: true })
  })

  it('skips when the member is opted_out', () => {
    expect(
      shouldPromptOptin({
        existingMember: MEMBER,
        activeMarketingConsent: optedOut(),
        recentPendingConsent: null,
        isSystemKeyword: false,
        now: NOW,
      })
    ).toEqual({ prompt: false, reason: 'opted_out' })
  })

  it('skips when a pending row was captured within the last 7 days', () => {
    const pending = pendingCapturedAt(
      new Date('2026-04-30T10:00:00.000Z') // 4 days ago
    )
    expect(
      shouldPromptOptin({
        existingMember: MEMBER,
        activeMarketingConsent: null,
        recentPendingConsent: pending,
        isSystemKeyword: false,
        now: NOW,
      })
    ).toEqual({ prompt: false, reason: 'recent_pending' })
  })

  it('prompts when the only pending row is older than 7 days', () => {
    // 7d 1h ago — outside window. The repo level is responsible for
    // surfacing only "recent" rows; this guard double-checks via capturedAt.
    const pending = pendingCapturedAt(
      new Date('2026-04-27T09:00:00.000Z')
    )
    expect(
      shouldPromptOptin({
        existingMember: MEMBER,
        activeMarketingConsent: null,
        recentPendingConsent: pending,
        isSystemKeyword: false,
        now: NOW,
      })
    ).toEqual({ prompt: true })
  })

  it('happy path: member exists, no consent, no pending, not a keyword → prompt', () => {
    expect(
      shouldPromptOptin({
        existingMember: MEMBER,
        activeMarketingConsent: null,
        recentPendingConsent: null,
        isSystemKeyword: false,
        now: NOW,
      })
    ).toEqual({ prompt: true })
  })
})
