import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/application/prompt-marketing-optin', () => ({
  promptMarketingOptin: vi.fn(),
}))

import { maybePromptOptin } from '../optin-prompt'
import { promptMarketingOptin } from '@/application/prompt-marketing-optin'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

function msg(partial: Partial<KapsoMessage> = {}): KapsoMessage {
  return {
    messageId: 'wamid.x',
    from: '+85291111111',
    type: 'text',
    text: 'Hello',
    contactName: 'Tester',
    timestamp: '1700000000',
    ...partial,
  } as KapsoMessage
}

describe('maybePromptOptin', () => {
  let logged: Array<[string, string, unknown]>

  beforeEach(() => {
    vi.clearAllMocks()
    logged = []
  })

  const log = (lvl: 'info' | 'warn' | 'error', evt: string, d: unknown) => {
    logged.push([lvl, evt, d])
  }

  it('skips system keywords (e.g. JOIN, POINTS) without calling the use case', async () => {
    await maybePromptOptin(msg({ text: 'JOIN' }), 'r-1', log)

    expect(promptMarketingOptin).not.toHaveBeenCalled()
    expect(logged.find((r) => r[1] === 'optin.skip')).toBeTruthy()
  })

  it('skips non-text inbounds (image, etc.)', async () => {
    await maybePromptOptin(
      msg({ type: 'image', text: undefined } as never),
      'r-1',
      log
    )

    expect(promptMarketingOptin).not.toHaveBeenCalled()
  })

  it('forwards qualifying inbounds to promptMarketingOptin with the messageId-derived source', async () => {
    vi.mocked(promptMarketingOptin).mockResolvedValue({ promptSent: true })

    await maybePromptOptin(
      msg({ text: 'Hi there', messageId: 'wamid.A1' }),
      'r-1',
      log
    )

    expect(promptMarketingOptin).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '+85291111111',
      source: 'inbound_first_wamid.A1',
    })
    expect(logged.some((r) => r[1] === 'optin.sent')).toBe(true)
  })

  it('logs and swallows errors so the webhook reliability is preserved', async () => {
    vi.mocked(promptMarketingOptin).mockRejectedValue(
      new Error('upstream blew up')
    )

    await expect(
      maybePromptOptin(msg({ text: 'Hi' }), 'r-1', log)
    ).resolves.toBeUndefined()

    expect(
      logged.some(
        (r) => r[0] === 'error' && r[1] === 'optin.prompt_failed'
      )
    ).toBe(true)
  })

  it('logs the reason on a gate skip without throwing', async () => {
    vi.mocked(promptMarketingOptin).mockResolvedValue({
      promptSent: false,
      reason: 'has_strong_consent',
    })

    await maybePromptOptin(msg({ text: 'Hi' }), 'r-1', log)

    const skip = logged.find((r) => r[1] === 'optin.skip')
    expect(skip?.[2]).toMatchObject({ reason: 'has_strong_consent' })
  })

  it('does not throw when PhoneNumber.create rejects an invalid `from` and logs the failure', async () => {
    await expect(
      maybePromptOptin(
        msg({ from: 'not-a-phone', text: 'Hi' }),
        'r-1',
        log
      )
    ).resolves.toBeUndefined()

    expect(promptMarketingOptin).not.toHaveBeenCalled()
    expect(
      logged.some(
        (r) => r[0] === 'error' && r[1] === 'optin.prompt_failed'
      )
    ).toBe(true)
  })
})
