import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  bookingDecisionOutcome,
  bookingsSettler,
  decideBooking,
  fetchBookings,
  decisionOutcomeHandler,
  noticeFor,
  runDecision,
  showsUndelivered,
  type BookingDecisionOutcome,
  type BookingsPayload,
} from '@/hooks/use-bookings'
import { needsExternalUrl, saveOutcome, toForm, toPayload } from '@/hooks/use-booking-settings'
import { DEFAULT_BOOKING_CONFIG, parseBookingSettings } from '@/domain/value-objects/booking-config'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('use-bookings helpers', () => {
  it('maps decision answers', () => {
    const booking = { id: 'b1', status: 'confirmed' }
    expect(bookingDecisionOutcome(200, { booking, delivered: false })).toEqual({ kind: 'done', booking, delivered: false })
    expect(bookingDecisionOutcome(409, { status: 'declined' })).toEqual({ kind: 'already_handled', status: 'declined' })
    expect(bookingDecisionOutcome(404, {})).toEqual({ kind: 'not_found' })
    expect(bookingDecisionOutcome(500, null)).toEqual({ kind: 'error' })
  })

  it('posts confirm/decline to the scoped endpoint with the reason only on decline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 404, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await decideBooking('b1', 'decline', 'Full')
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/bookings/b1/decline', expect.objectContaining({ body: '{"reason":"Full"}' }))
    await decideBooking('b1', 'confirm')
    expect(fetchMock.mock.calls[1][1].body).toBe('{}')
  })

  // I1 seam bug: a saved decision whose WhatsApp message was not delivered
  // showed "Confirmation sent" next to the "Message not delivered" badge.
  it('says sent only when the message was delivered (spec warning row)', () => {
    expect(noticeFor('confirm', { kind: 'done', booking: {} as never, delivered: false })).toBeNull()
    expect(noticeFor('decline', { kind: 'done', booking: {} as never, delivered: false })).toBeNull()
  })

  it('AC-F8 a declined change request (delivered null: no message by design) → no undelivered badge, no notice; BOOK-001 decline unchanged', () => {
    const booking = { id: 'b1', status: 'declined' }
    const change = bookingDecisionOutcome(200, { booking, delivered: null })
    expect(change).toEqual({ kind: 'done', booking, delivered: null })
    expect(showsUndelivered(change)).toBe(false)
    expect(noticeFor('decline', change)).toBeNull()
    // BOOK-001: a decline whose message failed still gets the badge; a delivered one says "Decline sent".
    const failed = bookingDecisionOutcome(200, { booking, delivered: false })
    expect(showsUndelivered(failed)).toBe(true)
    expect(noticeFor('decline', failed)).toBeNull()
    const sent = bookingDecisionOutcome(200, { booking, delivered: true })
    expect(showsUndelivered(sent)).toBe(false)
    expect(noticeFor('decline', sent)).toEqual({ kind: 'sent', decision: 'decline' })
    // A missing flag is still read as not delivered (old servers).
    expect(showsUndelivered(bookingDecisionOutcome(200, { booking }))).toBe(true)
  })

  // I1: zh-HK rendered '已已拒絕'. F14: en rendered 'already Declined' (the
  // status badge word, capitalised). The notice has its own status words.
  it('reads the already-handled notice naturally in both locales', async () => {
    const line = async (locale: string, status: string) => {
      const m = (await import(`@/messages/${locale}.json`)).default as {
        bookings: { alreadyHandled: string; alreadyHandledStatus: Record<string, string> }
      }
      return m.bookings.alreadyHandled.replace('{status}', m.bookings.alreadyHandledStatus[status])
    }
    expect(await line('en', 'declined')).toBe('This request was already declined.')
    expect(await line('en', 'confirmed')).toBe('This request was already confirmed.')
    for (const status of ['confirmed', 'declined']) {
      const zh = await line('zh-HK', status)
      expect(zh).not.toContain('已已')
      expect(zh).toMatch(/^此要求已(確認|拒絕)。$/)
    }
  })

  it('turns outcomes into notices', () => {
    expect(noticeFor('confirm', { kind: 'done', booking: {} as never, delivered: true })).toEqual({ kind: 'sent', decision: 'confirm' })
    expect(noticeFor('decline', { kind: 'already_handled', status: 'confirmed' })).toEqual({ kind: 'already_handled', status: 'confirmed' })
    expect(noticeFor('decline', { kind: 'not_found' })).toEqual({ kind: 'error' })
  })
})

describe('use-booking-settings helpers', () => {
  it('round-trips a config with no expiry to a null payload', () => {
    const form = toForm({ ...DEFAULT_BOOKING_CONFIG, mode: 'simple', chatLinkTtlHours: null })
    expect(form.chatLinkNoExpiry).toBe(true)
    expect(toPayload(form)).toEqual({
      mode: 'simple', externalUrl: null, chatLinkTtlHours: null, campaignLinkTtlHours: 168, maxPartySize: 20,
    })
  })

  // I1 seam bug: an invalid URL typed in External mode stayed in the hidden
  // field after switching to Simple/Off; the save then failed on a URL error
  // that those modes do not render, so Simple could never be saved.
  it('outside External mode sends only a valid stored URL, never an invalid draft', () => {
    const base = toForm(DEFAULT_BOOKING_CONFIG)
    expect(toPayload({ ...base, mode: 'simple', externalUrl: 'http://not-https.test' }).externalUrl).toBeNull()
    expect(toPayload({ ...base, mode: 'off', externalUrl: 'javascript:alert(1)' }).externalUrl).toBeNull()
    expect(toPayload({ ...base, mode: 'simple', externalUrl: ' https://inline.app/r/1 ' }).externalUrl).toBe('https://inline.app/r/1')
    expect(toPayload({ ...base, mode: 'external', externalUrl: 'http://not-https.test' }).externalUrl).toBe('http://not-https.test')
  })

  // F1 (review #1): lifetimes and party size are shown only in Simple mode. A
  // draft left invalid there (0 hours) must not fail an Off or External save
  // on a field those modes do not render.
  it.each(['off', 'external'] as const)('Simple → 0 in a lifetime → %s → the save passes server validation', (mode) => {
    const saved = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple' as const, chatLinkTtlHours: 48, maxPartySize: 12 }
    const form = { ...toForm(saved), chatLinkTtlHours: '0', campaignLinkTtlHours: '', maxPartySize: '0', mode, externalUrl: 'https://inline.app/r/1' }
    const result = parseBookingSettings(JSON.parse(JSON.stringify(toPayload(form))), saved)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config).toMatchObject({ mode, chatLinkTtlHours: 48, campaignLinkTtlHours: 168, maxPartySize: 12 })
  })

  it('outside Simple mode still sends a valid lifetime and party size the admin entered', () => {
    const form = { ...toForm(DEFAULT_BOOKING_CONFIG), chatLinkTtlHours: '12', maxPartySize: '8', mode: 'off' as const }
    expect(toPayload(form)).toMatchObject({ chatLinkTtlHours: 12, maxPartySize: 8 })
  })

  it('in Simple mode an invalid lifetime is still sent so the server shows the field error', () => {
    const form = { ...toForm(DEFAULT_BOOKING_CONFIG), mode: 'simple' as const, chatLinkTtlHours: '0' }
    expect(toPayload(form).chatLinkTtlHours).toBe(0)
  })

  it('flags external mode without a URL', () => {
    expect(needsExternalUrl({ ...toForm(DEFAULT_BOOKING_CONFIG), mode: 'external' })).toBe(true)
    expect(needsExternalUrl({ ...toForm(DEFAULT_BOOKING_CONFIG), mode: 'external', externalUrl: 'https://x.io' })).toBe(false)
  })

  it('maps save answers', () => {
    // W3: a save also carries the template statuses (null when absent).
    expect(saveOutcome(200, { config: DEFAULT_BOOKING_CONFIG })).toEqual({ kind: 'saved', config: DEFAULT_BOOKING_CONFIG, templates: null })
    expect(saveOutcome(400, { fields: { externalUrl: 'invalid_https_url' } })).toEqual({
      kind: 'fields', errors: { externalUrl: 'invalid_https_url' },
    })
    expect(saveOutcome(403, {})).toEqual({ kind: 'forbidden' })
  })
})

describe('fetchBookings (BOOK-004)', () => {
  it('asks for the date range and reads pendingCount and truncated', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bookings: [], pendingCount: 4, truncated: true }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchBookings({ from: '2026-11-01', to: '2026-12-05' })).toEqual({ bookings: [], pendingCount: 4, truncated: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/bookings?from=2026-11-01&to=2026-12-05')
  })

  it('asks for every pending booking with status=pending (needs-reply Show)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bookings: [], pendingCount: 0, truncated: false }) })
    vi.stubGlobal('fetch', fetchMock)
    await fetchBookings({ status: 'pending' })
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/bookings?status=pending')
  })

  it('throws on a failed answer so the page shows the error state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    await expect(fetchBookings({ from: '2026-11-01', to: '2026-11-30' })).rejects.toThrow()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const payload = (id: string): BookingsPayload => ({ bookings: [{ id } as never], pendingCount: 1, truncated: false })
const flush = () => new Promise((r) => setTimeout(r, 0))

// F2 (review 2026-11-19): a decision's refetch was settled with isActive=()=>true for the key of the
// click render; when the month changed meanwhile, the old month's answer landed last, replaced the
// new month's data, and the page showed Loading forever.
describe('useBookings settle (F2): only the current query may land', () => {
  it('a decision in flight + range change ends with the new range data, not the old range', async () => {
    const november = 'from=2026-11-01&to=2026-12-05'
    let current = november
    const loaded: Array<{ key: string; payload: BookingsPayload }> = []
    const settle = bookingsSettler(() => current, { loaded: (key, p) => loaded.push({ key, payload: p }), failed: () => {} })
    const oldRange = deferred<BookingsPayload>()
    const refetch = settle(november, oldRange.promise)
    current = 'from=2026-11-29&to=2027-01-02'
    await settle(current, Promise.resolve(payload('december')))
    oldRange.resolve(payload('november'))
    await refetch
    expect(loaded.at(-1)).toEqual({ key: current, payload: payload('december') })
    expect(loaded.map((l) => l.key)).not.toContain(november)
  })

  it("an old query's failure never shows the error state for the current one", async () => {
    let current = 'a'
    const failed = vi.fn()
    const settle = bookingsSettler(() => current, { loaded: () => {}, failed })
    const old = deferred<BookingsPayload>()
    const done = settle('a', old.promise)
    current = 'b'
    old.reject(new Error('boom'))
    await done
    expect(failed).not.toHaveBeenCalled()
  })

  it('the current query lands; an effect that was cleaned up does not', async () => {
    const loaded = vi.fn()
    const settle = bookingsSettler(() => 'a', { loaded, failed: () => {} })
    await settle('a', Promise.resolve(payload('x')), () => false)
    expect(loaded).not.toHaveBeenCalled()
    await settle('a', Promise.resolve(payload('x')))
    expect(loaded).toHaveBeenCalledWith('a', payload('x'))
  })
})

// BOOK-008 r1 F9 (CodeRabbit PR #214): two fetches of the SAME query (the mount fetch and a
// refetch after a decision or a member link, or two quick refetches) settled in arrival order,
// so a slow earlier answer landing last overwrote the newer data. Latest request wins.
describe('useBookings settle (r1 F9): the latest request for a query wins', () => {
  it('a slow earlier response arriving after a newer one does not overwrite the newer data', async () => {
    const key = 'from=2026-11-01&to=2026-12-05'
    const loaded: Array<{ key: string; payload: BookingsPayload }> = []
    const settle = bookingsSettler(() => key, { loaded: (k, p) => loaded.push({ key: k, payload: p }), failed: () => {} })
    const slow = deferred<BookingsPayload>()
    const first = settle(key, slow.promise)
    await settle(key, Promise.resolve(payload('after-link')))
    slow.resolve(payload('before-link'))
    await first
    expect(loaded).toEqual([{ key, payload: payload('after-link') }])
  })

  it("an earlier request's failure after a newer success never shows the error state", async () => {
    const failed = vi.fn()
    const loaded = vi.fn()
    const settle = bookingsSettler(() => 'a', { loaded, failed })
    const slow = deferred<BookingsPayload>()
    const first = settle('a', slow.promise)
    await settle('a', Promise.resolve(payload('new')))
    slow.reject(new Error('boom'))
    await first
    expect(failed).not.toHaveBeenCalled()
    expect(loaded).toHaveBeenCalledTimes(1)
  })

  it('settlers sharing one counter (the hook makes one per fetch) still let only the latest land', async () => {
    const loaded = vi.fn()
    const requests = { latest: 0 }
    const land = { loaded, failed: () => {} }
    const slow = deferred<BookingsPayload>()
    const first = bookingsSettler(() => 'a', land, requests)('a', slow.promise)
    await bookingsSettler(() => 'a', land, requests)('a', Promise.resolve(payload('new')))
    slow.resolve(payload('old'))
    await first
    expect(loaded.mock.calls.map((c) => c[1])).toEqual([payload('new')])
  })

  it('requests that answer in order all land, the newest last', async () => {
    const loaded = vi.fn()
    const settle = bookingsSettler(() => 'a', { loaded, failed: () => {} })
    await settle('a', Promise.resolve(payload('one')))
    await settle('a', Promise.resolve(payload('two')))
    expect(loaded.mock.calls.map((c) => c[1])).toEqual([payload('one'), payload('two')])
  })
})

// F4 (review 2026-11-19, pre-existing): busyId was cleared before the refetch, so the decided row's
// buttons re-enabled while it still showed Pending.
describe('runDecision (F4): the row stays busy until the list has reloaded', () => {
  const done: BookingDecisionOutcome = { kind: 'done', booking: {} as never, delivered: true }

  it('clears busy only after the refetch finishes', async () => {
    const busy: Array<string | null> = []
    const reload = deferred<void>()
    const onOutcome = vi.fn()
    const run = runDecision(
      { setBusyId: (id) => busy.push(id), decide: async () => done, onOutcome, refetch: () => reload.promise },
      { id: 'b1', decision: 'confirm' }
    )
    await flush()
    expect(onOutcome).toHaveBeenCalledWith(done)
    expect(busy).toEqual(['b1'])
    reload.resolve()
    await run
    expect(busy).toEqual(['b1', null])
  })

  it('clears busy even when the refetch throws', async () => {
    const busy: Array<string | null> = []
    const refetch = async () => {
      throw new Error('x')
    }
    const run = runDecision(
      { setBusyId: (id) => busy.push(id), decide: async () => done, onOutcome: () => {}, refetch },
      { id: 'b1', decision: 'decline', reason: 'Full' }
    )
    await expect(run).rejects.toThrow('x')
    expect(busy).toEqual(['b1', null])
  })
})

// BOOK-004 r4: runDecision (r3 F4) feeds the AGENT-003 F8 rule: a decline that sends no message by
// design (delivered: null) adds no "not delivered" badge; a failed message (false) still does.
describe('runDecision + decisionOutcomeHandler (F4 + F8)', () => {
  const booking = {} as never
  const run = async (delivered: boolean | null) => {
    const setNotice = vi.fn()
    const addUndelivered = vi.fn()
    await runDecision(
      {
        setBusyId: () => {},
        decide: async () => ({ kind: 'done', booking, delivered }),
        onOutcome: decisionOutcomeHandler('b1', 'decline', { setNotice, addUndelivered }),
        refetch: async () => {},
      },
      { id: 'b1', decision: 'decline' }
    )
    return { setNotice, addUndelivered }
  }

  it('delivered null: no undelivered badge and no notice', async () => {
    const { setNotice, addUndelivered } = await run(null)
    expect(addUndelivered).not.toHaveBeenCalled()
    expect(setNotice).toHaveBeenCalledWith(null)
  })

  it('delivered false: the row gets the undelivered badge', async () => {
    const { addUndelivered } = await run(false)
    expect(addUndelivered).toHaveBeenCalledWith('b1')
  })

  it('delivered true: the sent notice, no badge', async () => {
    const { setNotice, addUndelivered } = await run(true)
    expect(addUndelivered).not.toHaveBeenCalled()
    expect(setNotice).toHaveBeenCalledWith({ kind: 'sent', decision: 'decline' })
  })
})
