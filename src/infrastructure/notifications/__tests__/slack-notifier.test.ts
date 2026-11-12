import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { OpsAlert } from '@/domain/value-objects/ops-alert'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  vi.restoreAllMocks()
})

function buildAlert(overrides: Partial<OpsAlert> = {}): OpsAlert {
  return {
    kind: 'quality_transition_red',
    severity: 'critical',
    restaurantId: 'rest-1',
    restaurantName: 'Cafe Latte',
    message: 'Tenant flipped to RED',
    ...overrides,
  }
}

async function importNotifier() {
  return await import('../slack-notifier')
}

describe('createSlackNotifier', () => {
  it('POSTs to SLACK_WEBHOOK_URL_CS when channel=cs', async () => {
    process.env.SLACK_WEBHOOK_URL_CS = 'https://slack.example/cs'
    process.env.SLACK_WEBHOOK_URL_PLATFORM = 'https://slack.example/platform'
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }))

    const { createSlackNotifier } = await importNotifier()
    const notifier = createSlackNotifier()
    await notifier.send({
      channel: 'cs',
      alert: buildAlert({ kind: 'quality_transition_yellow', severity: 'warn' }),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://slack.example/cs')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('POSTs to SLACK_WEBHOOK_URL_PLATFORM when channel=platform', async () => {
    process.env.SLACK_WEBHOOK_URL_CS = 'https://slack.example/cs'
    process.env.SLACK_WEBHOOK_URL_PLATFORM = 'https://slack.example/platform'
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }))

    const { createSlackNotifier } = await importNotifier()
    await createSlackNotifier().send({ channel: 'platform', alert: buildAlert() })

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://slack.example/platform')
  })

  it('formats payload with severity color, kind, restaurant name, and message', async () => {
    process.env.SLACK_WEBHOOK_URL_PLATFORM = 'https://slack.example/platform'
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }))

    const { createSlackNotifier } = await importNotifier()
    await createSlackNotifier().send({
      channel: 'platform',
      alert: buildAlert({
        kind: 'quality_transition_red',
        severity: 'critical',
        restaurantName: 'Cafe Latte',
        message: 'Tenant flipped to RED',
      }),
    })

    const init = fetchMock.mock.calls[0][1]!
    const body = JSON.parse(init.body as string)
    expect(body.attachments).toHaveLength(1)
    const attachment = body.attachments[0]
    expect(attachment.color).toBe('#FF0000')
    // Kind appears somewhere in title or text.
    const blob = JSON.stringify(attachment)
    expect(blob).toContain('quality_transition_red')
    expect(blob).toContain('Cafe Latte')
    expect(blob).toContain('Tenant flipped to RED')
  })

  it.each([
    ['info', '#9E9E9E'],
    ['warn', '#FFC107'],
    ['error', '#FF9800'],
    ['critical', '#FF0000'],
  ])('severity=%s uses color %s', async (severity, color) => {
    process.env.SLACK_WEBHOOK_URL_PLATFORM = 'https://slack.example/platform'
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }))

    const { createSlackNotifier } = await importNotifier()
    await createSlackNotifier().send({
      channel: 'platform',
      alert: buildAlert({ severity: severity as OpsAlert['severity'] }),
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(body.attachments[0].color).toBe(color)
  })

  it('is a no-op when the channel env var is missing — does NOT call fetch, does NOT throw', async () => {
    // No SLACK_WEBHOOK_URL_CS configured.
    delete process.env.SLACK_WEBHOOK_URL_CS
    process.env.SLACK_WEBHOOK_URL_PLATFORM = 'https://slack.example/platform'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const { createSlackNotifier } = await importNotifier()
    await expect(
      createSlackNotifier().send({ channel: 'cs', alert: buildAlert() })
    ).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('swallows fetch rejections so alerting failures NEVER crash production code', async () => {
    process.env.SLACK_WEBHOOK_URL_PLATFORM = 'https://slack.example/platform'
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { createSlackNotifier } = await importNotifier()
    await expect(
      createSlackNotifier().send({ channel: 'platform', alert: buildAlert() })
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('treats non-2xx responses as a soft failure (log warn, do not throw)', async () => {
    process.env.SLACK_WEBHOOK_URL_PLATFORM = 'https://slack.example/platform'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 })
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { createSlackNotifier } = await importNotifier()
    await expect(
      createSlackNotifier().send({ channel: 'platform', alert: buildAlert() })
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })
})
