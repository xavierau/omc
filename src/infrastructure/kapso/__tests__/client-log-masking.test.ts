import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// R8 (BOOK-001 threat model): no full recipient number in logs. The skip paths
// (no API key, no phoneNumberId) log a summary of the unsent message; the number
// in it must be masked to its last 4 digits, as maskPhone does elsewhere.

vi.mock('@kapso/whatsapp-cloud-api', () => ({
  WhatsAppClient: class {
    messages = {}
  },
}))

const OLD_ENV = process.env
const TO = '+85291234567'
const FULL_DIGITS = '91234567'

type Client = typeof import('../client')
type Send = (c: Client, phoneNumberId: string) => Promise<unknown>

const SENDERS: Array<[string, Send]> = [
  ['sendTextMessage', (c, p) => c.sendTextMessage(p, TO, 'hi')],
  ['sendImageMessage', (c, p) => c.sendImageMessage(p, TO, 'https://x.test/a.png')],
  ['sendInteractiveButtons', (c, p) =>
    c.sendInteractiveButtons(p, TO, 'body', [{ id: 'A', title: 'A' }])],
  ['sendInteractiveList', (c, p) =>
    c.sendInteractiveList(p, TO, 'body', 'Options', [{ rows: [{ id: 'A', title: 'A' }] }])],
  ['sendInteractiveFlow', (c, p) =>
    c.sendInteractiveFlow(p, TO, 'body', {
      flowId: 'f', flowCta: 'Go', flowToken: 't', screen: 'S', data: {},
    })],
  ['sendCtaUrlButton', (c, p) =>
    c.sendCtaUrlButton(p, TO, 'body', 'Book now', 'https://x.test/b/tok')],
]

let warn: ReturnType<typeof vi.spyOn>

async function importClient(): Promise<Client> {
  vi.resetModules()
  return import('../client')
}

function loggedText(): string {
  return JSON.stringify(warn.mock.calls)
}

beforeEach(() => {
  process.env = { ...OLD_ENV }
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  process.env = OLD_ENV
  warn.mockRestore()
})

describe('kapso client skip logs mask the recipient (R8)', () => {
  it.each(SENDERS)('%s with no API key logs only the last 4 digits', async (_n, send) => {
    delete process.env.KAPSO_API_KEY
    await send(await importClient(), 'pn-1')
    expect(warn).toHaveBeenCalled()
    expect(loggedText()).not.toContain(FULL_DIGITS)
    expect(loggedText()).toContain('***4567')
  })

  it.each(SENDERS)('%s with no phoneNumberId logs only the last 4 digits', async (_n, send) => {
    process.env.KAPSO_API_KEY = 'test-key'
    await send(await importClient(), '')
    expect(warn).toHaveBeenCalled()
    expect(loggedText()).not.toContain(FULL_DIGITS)
    expect(loggedText()).toContain('***4567')
  })
})
