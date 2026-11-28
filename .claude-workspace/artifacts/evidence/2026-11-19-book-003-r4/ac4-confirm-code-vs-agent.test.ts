// BOOK-003 r4 AC-4 (R31) after merging AGENT-001: a live confirm code from the
// booking phone is handled by the confirm-code path and never reaches the AI
// reply agent; free text with no matching code still reaches the agent path.
// Lives in the evidence folder (files_allowed); run with
//   npx vitest run --config .claude-workspace/artifacts/evidence/2026-11-19-book-003-r4/vitest.ac4.config.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/api/webhooks/whatsapp/service-window', () => ({ bumpServiceWindow: vi.fn() }))
vi.mock('@/application/restore-member-reachability', () => ({ restoreMemberReachability: vi.fn() }))
vi.mock('@/app/api/webhooks/whatsapp/optin-prompt', () => ({ maybePromptOptin: vi.fn() }))
vi.mock('@/app/api/webhooks/whatsapp/language-handler', () => ({
  maybeHandleLanguageCommand: vi.fn(async () => false),
  maybeDetectLanguageForExistingMember: vi.fn(),
}))
vi.mock('@/app/api/webhooks/whatsapp/resolve-language', () => ({ resolveLanguageForMember: vi.fn() }))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({ findMemberByPhone: vi.fn(async () => null) }))
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantPhoneNumberId: vi.fn(async () => 'pn-a'),
  getReplyConfig: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({ sendCtaUrlButton: vi.fn(), sendTextMessage: vi.fn() }))
vi.mock('@/app/api/webhooks/whatsapp/member-handlers', () => ({
  handleRedeem: vi.fn(), handleUnsubscribe: vi.fn(), handleRewards: vi.fn(), handleRewardRedeem: vi.fn(),
}))
vi.mock('@/app/api/webhooks/whatsapp/claim-handler', () => ({ handleClaim: vi.fn() }))
vi.mock('@/app/api/webhooks/whatsapp/join-and-image-handlers', () => ({ handleJoin: vi.fn(), handleReceiptImage: vi.fn(), handlePoints: vi.fn() }))
vi.mock('@/app/api/webhooks/whatsapp/contact-handler', () => ({ handleContact: vi.fn() }))
vi.mock('@/app/api/webhooks/whatsapp/contact-form-handler', () => ({ handleContactFormSubmission: vi.fn() }))
vi.mock('@/app/api/webhooks/whatsapp/my-card-handler', () => ({ handleMyCard: vi.fn() }))
vi.mock('@/app/api/webhooks/whatsapp/unknown-help-handlers', () => ({ handleUnknown: vi.fn(), handleHelp: vi.fn() }))
vi.mock('@/app/api/webhooks/whatsapp/receipt-confirmation', () => ({ handleReceiptConfirmation: vi.fn(async () => false) }))
vi.mock('@/app/api/webhooks/whatsapp/optin-confirmation', () => ({
  handleOptinConfirmation: vi.fn(async () => false), handleOptinRejection: vi.fn(async () => false),
}))
vi.mock('@/app/api/webhooks/whatsapp/book-handler', () => ({ handleBookCommand: vi.fn(), maybeReplyToBookingIntent: vi.fn(async () => false) }))
vi.mock('@/application/booking/booking-deps', () => ({ verifyAgentBookingDeps: vi.fn() }))
// The AI reply agent entry point: a spy that reports "queued" (auto mode).
vi.mock('@/app/api/webhooks/whatsapp/agent-handler', () => ({ maybeQueueAgentReply: vi.fn(async () => true) }))

import { routeMessage } from '@/app/api/webhooks/whatsapp/handlers'
import { maybeQueueAgentReply } from '@/app/api/webhooks/whatsapp/agent-handler'
import { handleUnknown } from '@/app/api/webhooks/whatsapp/unknown-help-handlers'
import { verifyAgentBookingDeps } from '@/application/booking/booking-deps'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeAgentBookingStore } from '@/application/booking/__tests__/fake-agent-booking'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

const R = 'rest-a'
const PHONE = '+85291234567'
const OTHER = '+85298765432'
const NOW = new Date('2026-11-19T02:10:00.000Z')
const CONFIRM_TEXT = '確認Cafe A訂座 Confirm my booking at Cafe A: K7PX3M'
const AGENT_ON = { enabled: true, publicId: 'P'.repeat(32), websiteHost: 'www.cafe-a.hk' }

let store: FakeAgentBookingStore
let sender: FakeBookingSender

function msg(partial: Partial<KapsoMessage>): KapsoMessage {
  return { messageId: 'wamid.1', from: PHONE, type: 'text', timestamp: '1700000000', text: CONFIRM_TEXT, ...partial } as KapsoMessage
}

beforeEach(async () => {
  vi.clearAllMocks()
  store = new FakeAgentBookingStore()
  sender = new FakeBookingSender()
  const settings = new FakeBookingSettings()
  settings.restaurants.set(R, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  settings.setConfig(R, { mode: 'simple', agentBooking: AGENT_ON })
  vi.mocked(verifyAgentBookingDeps).mockImplementation(() => ({
    store, settings, sender,
    sendText: async () => undefined,
    privacyUrl: 'https://ohmyclient.io/privacy-policy.html',
    now: () => NOW,
  }))
  store.createdAt = () => new Date('2026-11-19T02:00:00.000Z')
  await store.insert({
    restaurantId: R, phone: PHONE, name: 'Chan Tai Man', partySize: 4, bookingDate: '2026-11-20',
    bookingTime: '19:30', notes: null, confirmCode: 'K7PX3M', verifyExpiresAt: '2026-11-19T02:30:00.000Z',
    statusTokenHash: 'a'.repeat(64), idempotencyKey: null,
  })
})

describe('BOOK-003 r4 AC-4: confirm code never reaches the AI reply agent (R31)', () => {
  it('a live confirm code from the booking phone → confirm-code path, maybeQueueAgentReply not called', async () => {
    await routeMessage(msg({}), R)
    expect(store.rows[0]).toMatchObject({ status: 'pending', verifiedWamid: 'wamid.1', confirmCode: null })
    expect(sender.sent).toHaveLength(1)
    expect(maybeQueueAgentReply).not.toHaveBeenCalled()
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('the same code from another phone does not promote and reaches the agent path as on develop', async () => {
    await routeMessage(msg({ from: OTHER }), R)
    expect(store.rows[0].status).not.toBe('pending')
    expect(sender.sent).toHaveLength(0)
    expect(maybeQueueAgentReply).toHaveBeenCalledTimes(1)
  })

  it('free text with no code reaches the agent path as on develop', async () => {
    await routeMessage(msg({ text: 'Do you have vegetarian dishes?' }), R)
    expect(sender.sent).toHaveLength(0)
    expect(maybeQueueAgentReply).toHaveBeenCalledTimes(1)
    expect(handleUnknown).not.toHaveBeenCalled()
  })
})
