// BOOK-003 review F8: the poppy.json download link is attached to the page,
// clicked, removed, and its blob URL revoked only after the click has had a
// chance to start the download (Firefox and Safari ignore a detached link or
// an already-revoked URL).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadPoppyJson } from '../use-booking-settings'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubPage() {
  const log: string[] = []
  const link = {
    href: '',
    download: '',
    click: vi.fn(() => log.push(`click:${link.isConnected}`)),
    remove: vi.fn(() => {
      link.isConnected = false
      log.push('remove')
    }),
    isConnected: false,
  }
  vi.stubGlobal('document', {
    createElement: vi.fn(() => link),
    body: {
      appendChild: vi.fn((el: typeof link) => {
        el.isConnected = true
        log.push('append')
        return el
      }),
    },
  })
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:poppy'), revokeObjectURL: vi.fn(() => log.push('revoke')) })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"protocol_version":"1.0"}', { status: 200 })))
  return { link, log }
}

describe('downloadPoppyJson (F8)', () => {
  it('appends the link to the body, clicks it while attached, removes it, then revokes the URL on a later tick', async () => {
    vi.useFakeTimers()
    const { link, log } = stubPage()
    expect(await downloadPoppyJson()).toBe(true)
    expect(link).toMatchObject({ href: 'blob:poppy', download: 'poppy.json' })
    expect(log).toEqual(['append', 'click:true', 'remove'])
    vi.runAllTimers()
    expect(log).toEqual(['append', 'click:true', 'remove', 'revoke'])
  })

  it('a refused download creates no link', async () => {
    const { log } = stubPage()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 409 })))
    expect(await downloadPoppyJson()).toBe(false)
    expect(log).toEqual([])
  })
})
