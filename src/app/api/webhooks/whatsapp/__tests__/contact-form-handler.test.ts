import { describe, it, expect, vi, beforeEach } from 'vitest'
import { okResult, failResult } from '@/test-utils/send-result'

vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getContactConfig: vi.fn(),
  getRestaurantEmailContext: vi.fn(),
}))
vi.mock('@/infrastructure/queue/email-queue', () => ({
  addEmailJob: vi.fn(),
}))
vi.mock('../unknown-help-handlers', () => ({
  handleUnknown: vi.fn(),
}))

import { handleContactFormSubmission } from '../contact-form-handler'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import {
  getContactConfig,
  getRestaurantEmailContext,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { addEmailJob } from '@/infrastructure/queue/email-queue'
import { handleUnknown } from '../unknown-help-handlers'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { DEFAULT_LABELS, type ResolvedContactConfig } from '@/domain/services/contact-config'

const PHONE_NUMBER_ID = 'pn-1'
const PHONE = '85291234567'
const RESTAURANT_ID = 'r-1'

function makeMessage(partial: Partial<KapsoMessage> = {}): KapsoMessage {
  return {
    messageId: 'wamid.test',
    from: PHONE,
    type: 'interactive',
    timestamp: new Date().toISOString(),
    contactName: 'Alice Chan',
    flowResponse: {
      // camelCase: the Kapso SDK forces strict-camelCase Flow JSON authoring
      // (`toFlowJsonWireCase`), so a real nfm_reply.response_json carries
      // these keys, not snake_case (see contact-form-submission.ts doc).
      clientName: 'Alice',
      clientWhatsapp: '85291234567',
      topic: '訂座查詢',
    },
    flowToken: `cf.v1.${RESTAURANT_ID}.abc-123`,
    ...partial,
  } as KapsoMessage
}

function config(overrides: Partial<ResolvedContactConfig> = {}): ResolvedContactConfig {
  return {
    mode: 'form',
    notificationEmail: 'owner@example.com',
    topics: ['a', 'b', 'c', 'd', 'e'],
    ackText: null,
    labels: DEFAULT_LABELS,
    ...overrides,
  }
}

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void

async function run(overrides: {
  message?: Partial<KapsoMessage>
  log?: LogFn
} = {}) {
  const log: LogFn = overrides.log ?? vi.fn()
  await handleContactFormSubmission({
    message: makeMessage(overrides.message),
    restaurantId: RESTAURANT_ID,
    phoneNumberId: PHONE_NUMBER_ID,
    phone: PHONE,
    log,
  })
  return log
}

describe('handleContactFormSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendTextMessage).mockResolvedValue(okResult())
    vi.mocked(getContactConfig).mockResolvedValue(config())
    vi.mocked(getRestaurantEmailContext).mockResolvedValue({
      name: 'Demo Cafe',
      whatsappNumber: '+85299999999',
    })
    vi.mocked(addEmailJob).mockResolvedValue(undefined)
    vi.mocked(handleUnknown).mockResolvedValue(okResult())
  })

  it('happy path: sends ack, then enqueues the email job with correct recipient + submission', async () => {
    await run()

    expect(sendTextMessage).toHaveBeenCalledWith(PHONE_NUMBER_ID, PHONE, expect.any(String))
    expect(addEmailJob).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        notificationEmail: 'owner@example.com',
        submission: expect.objectContaining({ clientName: 'Alice' }),
        senderWaId: PHONE,
        contactName: 'Alice Chan',
        messageId: 'wamid.test',
        submittedAt: expect.any(String),
      })
    )
    const ackOrder = vi.mocked(sendTextMessage).mock.invocationCallOrder[0]
    const enqueueOrder = vi.mocked(addEmailJob).mock.invocationCallOrder[0]
    expect(ackOrder).toBeLessThan(enqueueOrder)
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('custom ackText is used when set; DEFAULT_ACK_TEXT otherwise', async () => {
    vi.mocked(getContactConfig).mockResolvedValue(config({ ackText: '自訂多謝訊息' }))
    await run()
    expect(sendTextMessage).toHaveBeenCalledWith(PHONE_NUMBER_ID, PHONE, '自訂多謝訊息')
  })

  it('invalid payload: delegates to handleUnknown, sends no ack/email, logs invalid_payload', async () => {
    const log = await run({ message: { flowResponse: { foo: 'bar' } } })

    expect(handleUnknown).toHaveBeenCalledWith(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(addEmailJob).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'warn',
      'contact_form.invalid_payload',
      expect.objectContaining({ reason: expect.any(String) })
    )
  })

  it('token mismatch (other tenant): drops silently — no ack, no email, warn logged', async () => {
    const log = await run({ message: { flowToken: 'cf.v1.other-restaurant.xyz' } })

    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(addEmailJob).not.toHaveBeenCalled()
    expect(handleUnknown).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'warn',
      'contact_form.token_mismatch',
      expect.objectContaining({ restaurantId: RESTAURANT_ID })
    )
  })

  it('token missing: still processed (ack sent + email enqueued), warn logged', async () => {
    const log = await run({ message: { flowToken: undefined } })

    expect(sendTextMessage).toHaveBeenCalled()
    expect(addEmailJob).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'warn',
      'contact_form.token_missing',
      expect.objectContaining({ restaurantId: RESTAURANT_ID })
    )
  })

  it('foreign token prefix (not our contact form): falls through to handleUnknown', async () => {
    await run({ message: { flowToken: 'other-feature.v1.xyz' } })

    expect(handleUnknown).toHaveBeenCalledWith(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(addEmailJob).not.toHaveBeenCalled()
  })

  it('notificationEmail null: ack sent, no email enqueued, logged', async () => {
    vi.mocked(getContactConfig).mockResolvedValue(config({ notificationEmail: null }))
    const log = await run()

    expect(sendTextMessage).toHaveBeenCalled()
    expect(addEmailJob).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'warn',
      'contact_form.no_notification_email',
      expect.objectContaining({ restaurantId: RESTAURANT_ID })
    )
  })

  it('enqueue failure (Redis down): ack already sent, handler still resolves, error logged — never throws', async () => {
    vi.mocked(addEmailJob).mockRejectedValue(new Error('ECONNREFUSED'))

    const log = vi.fn()
    await expect(run({ log })).resolves.toBeDefined()

    expect(sendTextMessage).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'error',
      'contact_form.enqueue_failed',
      expect.objectContaining({ error: expect.stringContaining('ECONNREFUSED') })
    )
  })

  it('ack send failure: logged but does not prevent the email job from being enqueued', async () => {
    vi.mocked(sendTextMessage).mockResolvedValue(failResult('skip'))
    const log = await run()

    expect(addEmailJob).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('warn', 'contact_form.ack_send_failed', expect.anything())
  })

  it('an unexpected rejection anywhere in the pipeline is caught — handler still resolves', async () => {
    vi.mocked(getContactConfig).mockRejectedValue(new Error('db exploded'))
    const log = await run()

    expect(log).toHaveBeenCalledWith(
      'error',
      'contact_form.unexpected_error',
      expect.objectContaining({ error: expect.stringContaining('db exploded') })
    )
  })

  it.each([
    ['invalid payload', { flowResponse: {} }],
    ['token mismatch', { flowToken: 'cf.v1.other.xyz' }],
    ['foreign token', { flowToken: 'nope.xyz' }],
    ['token missing', { flowToken: undefined }],
  ])('%s: never rejects', async (_name, partial) => {
    await expect(run({ message: partial })).resolves.toBeDefined()
  })
})
