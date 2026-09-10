import { describe, it, expect, vi, beforeEach } from 'vitest'

const { UnrecoverableError } = vi.hoisted(() => {
  class UnrecoverableError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'UnrecoverableError'
    }
  }
  return { UnrecoverableError }
})

vi.mock('bullmq', () => ({ UnrecoverableError }))

const sendEmail = vi.fn()
vi.mock('@/infrastructure/email/provider-factory', () => ({
  getEmailProvider: () => ({ send: sendEmail }),
}))

const getContactConfig = vi.fn()
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getContactConfig: (...args: unknown[]) => getContactConfig(...args),
}))

const notifyOpsAlert = vi.fn().mockResolvedValue(undefined)
vi.mock('@/application/notify-ops-alert', () => ({
  notifyOpsAlert: (...args: unknown[]) => notifyOpsAlert(...args),
}))

import { processEmailJob, isPermanentFailure, handleExhaustedRetries } from '../email-job-processor'
import { DEFAULT_LABELS } from '@/domain/services/contact-config'
import { buildContactEmail } from '@/domain/services/contact-email'
import type { EmailJobData } from '../email-queue'
import type { EmailSendResult } from '@/domain/value-objects/email-send-result'

function buildJobData(overrides: Partial<EmailJobData> = {}): EmailJobData {
  return {
    restaurantId: 'r-1',
    notificationEmail: 'owner@example.com',
    submission: { clientName: 'Alice', clientWhatsapp: '85291234567', topic: '訂座查詢' },
    senderWaId: '85291234567',
    contactName: 'Alice Chan',
    messageId: 'wamid.001',
    submittedAt: '2026-01-01T03:00:00.000Z',
    ...overrides,
  }
}

function okResult(): EmailSendResult {
  return { ok: true, providerMessageId: 'em-1', raw: null }
}

function failResult(title: string, details?: string): EmailSendResult {
  return { ok: false, providerMessageId: null, raw: null, error: { title, details } }
}

describe('processEmailJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyOpsAlert.mockResolvedValue(undefined)
    getContactConfig.mockResolvedValue({
      mode: 'form',
      notificationEmail: 'owner@example.com',
      topics: [],
      ackText: null,
      labels: DEFAULT_LABELS,
    })
  })

  it('resolves without throwing when the send succeeds', async () => {
    sendEmail.mockResolvedValue(okResult())

    await expect(processEmailJob(buildJobData())).resolves.toBeUndefined()
  })

  it('sends to the job data recipient with content built from submittedAt, not "now"', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-06-15T12:00:00.000Z'))
    sendEmail.mockResolvedValue(okResult())
    const data = buildJobData({ submittedAt: '2026-01-01T03:00:00.000Z' })

    await processEmailJob(data)

    const expected = buildContactEmail(data.submission, {
      senderWaId: data.senderWaId,
      contactName: data.contactName,
      timestamp: new Date(data.submittedAt),
      labels: DEFAULT_LABELS,
    })
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'owner@example.com',
      subject: expected.subject,
      text: expected.text,
    })
    vi.useRealTimers()
  })

  it('throws a plain Error (not UnrecoverableError) on a transient timeout, and does not alert', async () => {
    sendEmail.mockResolvedValue(failResult('resend_timeout'))

    await expect(processEmailJob(buildJobData())).rejects.toThrow(Error)
    await expect(processEmailJob(buildJobData())).rejects.not.toBeInstanceOf(UnrecoverableError)
    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })

  it('throws a plain Error on a 5xx non-2xx response and does not alert', async () => {
    sendEmail.mockResolvedValue(failResult('resend_non_2xx', 'HTTP 500: server error'))

    await expect(processEmailJob(buildJobData())).rejects.not.toBeInstanceOf(UnrecoverableError)
    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })

  it('throws a plain Error on 429 (rate limit) — retryable, not permanent', async () => {
    sendEmail.mockResolvedValue(failResult('resend_non_2xx', 'HTTP 429: too many requests'))

    await expect(processEmailJob(buildJobData())).rejects.not.toBeInstanceOf(UnrecoverableError)
    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })

  it('throws UnrecoverableError on a 4xx non-2xx response (bad recipient) and alerts once', async () => {
    sendEmail.mockResolvedValue(failResult('resend_non_2xx', 'HTTP 422: invalid recipient'))
    const data = buildJobData()

    await expect(processEmailJob(data)).rejects.toBeInstanceOf(UnrecoverableError)

    expect(notifyOpsAlert).toHaveBeenCalledTimes(1)
    expect(notifyOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'engineering_alert',
        restaurantId: data.restaurantId,
        details: expect.objectContaining({ messageId: data.messageId }),
      })
    )
  })

  it('throws UnrecoverableError when Resend is not configured and alerts once', async () => {
    sendEmail.mockResolvedValue(failResult('resend_not_configured'))

    await expect(processEmailJob(buildJobData())).rejects.toBeInstanceOf(UnrecoverableError)
    expect(notifyOpsAlert).toHaveBeenCalledTimes(1)
  })

  it('still throws UnrecoverableError even if notifyOpsAlert itself throws', async () => {
    sendEmail.mockResolvedValue(failResult('resend_not_configured'))
    notifyOpsAlert.mockRejectedValue(new Error('slack down'))

    await expect(processEmailJob(buildJobData())).rejects.toBeInstanceOf(UnrecoverableError)
  })
})

describe('isPermanentFailure', () => {
  it.each([400, 401, 403, 404, 422])('treats HTTP %i as permanent', (status) => {
    expect(isPermanentFailure(failResult('resend_non_2xx', `HTTP ${status}: bad`))).toBe(true)
  })

  it.each([429, 500, 502, 503])('treats HTTP %i as transient', (status) => {
    expect(isPermanentFailure(failResult('resend_non_2xx', `HTTP ${status}: bad`))).toBe(false)
  })

  it('treats resend_not_configured as permanent', () => {
    expect(isPermanentFailure(failResult('resend_not_configured'))).toBe(true)
  })

  it('treats resend_no_message_id as permanent — a 2xx with no id may have already sent, so a retry risks a duplicate', () => {
    expect(isPermanentFailure(failResult('resend_no_message_id'))).toBe(true)
  })

  it.each(['resend_timeout', 'resend_send_error'])('treats %s as transient', (title) => {
    expect(isPermanentFailure(failResult(title))).toBe(false)
  })

  it('treats a successful result as not permanent', () => {
    expect(isPermanentFailure(okResult())).toBe(false)
  })
})

describe('handleExhaustedRetries', () => {
  function buildFakeJob(overrides: Partial<{ attemptsMade: number; attempts: number }> = {}) {
    return {
      data: buildJobData(),
      attemptsMade: overrides.attemptsMade ?? 3,
      opts: { attempts: overrides.attempts ?? 3 },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    notifyOpsAlert.mockResolvedValue(undefined)
  })

  it('does nothing for an UnrecoverableError (already alerted before the throw)', async () => {
    await handleExhaustedRetries(buildFakeJob(), new UnrecoverableError('permanent'))

    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })

  it('does nothing while attempts remain', async () => {
    await handleExhaustedRetries(buildFakeJob({ attemptsMade: 2, attempts: 3 }), new Error('timeout'))

    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })

  it('alerts once retries are exhausted on a transient failure', async () => {
    await handleExhaustedRetries(buildFakeJob({ attemptsMade: 3, attempts: 3 }), new Error('timeout'))

    expect(notifyOpsAlert).toHaveBeenCalledTimes(1)
    expect(notifyOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'engineering_alert',
        details: expect.objectContaining({ title: 'retries_exhausted' }),
      })
    )
  })
})
