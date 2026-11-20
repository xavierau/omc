/**
 * BOOK-008 AC-5: the member panel's Bookings section (stats + list, empty and
 * unavailable states); in every booking view the diner name of a linked
 * booking opens the member panel (plain text when unlinked, or outside the
 * Bookings screen); the Link member / Change member / Unlink member control,
 * its member search and the PATCH call, which always reloads the list.
 * No DOM here (repo convention): markup via renderToStaticMarkup, handlers
 * via the element a probe component captures during render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { MemberBookingsSection } from '../member-bookings-section'
import { CalendarDayPanel } from '../bookings/calendar-day-panel'
import { BookingsTableDesktop } from '../bookings/bookings-table-desktop'
import { BookingsTableCards } from '../bookings/bookings-table-cards'
import { BookingGuestName, MemberLinkControl, MemberLinkNoticeLine, SearchResults } from '../bookings/booking-member'
import {
  BookingMemberContext,
  memberLinkAction,
  memberLinkOutcome,
  memberSearchUrl,
  requestMemberLink,
  searchMembers,
  startMemberSearch,
  type BookingMemberActions,
  type MemberSearchState,
} from '../bookings/use-booking-member'
import type { BookingItem } from '@/hooks/use-bookings'
import type { MemberBookingHistory } from '@/domain/entities/member-booking'

const MEMBER = '5d1b0c2e-0000-4000-8000-000000000001'

const b = (id: string, memberId: string | null, status: BookingItem['status'] = 'pending'): BookingItem => ({
  id, restaurantId: 'r', memberId, phone: '+85290000001', name: `Diner ${id}`, partySize: 2, bookingDate: '2026-11-25',
  bookingTime: '19:30', notes: null, status, declineReason: null, decidedBy: null, decidedAt: null, source: 'chat',
  campaignId: null, createdAt: '2026-11-01T00:00:00Z', decisionMessageStatus: null,
})

const linked = b('ln', MEMBER)
const unlinked = b('un', null)
const all = [linked, unlinked]

function actions(): BookingMemberActions & { opened: string[]; links: Array<[string, string | null]> } {
  const opened: string[] = []
  const links: Array<[string, string | null]> = []
  return {
    opened, links, busyIds: new Set<string>(),
    openMember: (id) => void opened.push(id),
    link: async (id, memberId) => void links.push([id, memberId]),
  }
}

const rowActions = { busyIds: new Set<string>(), undelivered: new Set<string>(), onDecide: () => {}, onNoShow: () => {} }
const groups = [{ date: '2026-11-25', bookings: all }]
const views: Record<string, () => ReactNode> = {
  'desktop table': () => <BookingsTableDesktop groups={groups} today="2026-11-20" {...rowActions} />,
  'phone cards': () => <BookingsTableCards groups={groups} today="2026-11-20" {...rowActions} />,
  'calendar day panel': () => <CalendarDayPanel date="2026-11-25" bookings={all} monthEmpty={false} {...rowActions} />,
}

const withMembers = (node: ReactNode, value: BookingMemberActions | null = actions()) =>
  renderToStaticMarkup(<BookingMemberContext.Provider value={value}>{node}</BookingMemberContext.Provider>)

/** Renders `render()` inside a component so its hooks run, and returns the element it produced. */
function capture(render: () => ReactElement | null, value: BookingMemberActions): ReactElement | null {
  let el: ReactElement | null = null
  function Probe() {
    el = render()
    return el
  }
  withMembers(<Probe />, value)
  return el
}

type AnyProps = { props: { children?: unknown; onClick?: () => void; onPick?: () => void; [k: string]: unknown } }

/** Depth-first search of an element tree by a prop value. */
function findBy(node: unknown, prop: string, value: unknown): AnyProps | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findBy(child, prop, value)
      if (hit) return hit
    }
    return null
  }
  const el = node as AnyProps
  if (el.props?.[prop] === value) return el
  return findBy(el.props?.children, prop, value)
}

describe('member panel Bookings section (R8)', () => {
  const history: MemberBookingHistory = {
    bookings: [
      { id: 'm1', bookingDate: '2026-11-25', bookingTime: '19:30', partySize: 4, status: 'confirmed' },
      { id: 'm2', bookingDate: '2026-11-10', bookingTime: '12:00', partySize: 2, status: 'no_show' },
    ],
    stats: { total: 60, confirmed: 20, cancelled: 10, declined: 5, noShow: 3, pending: 22, lastBookingDate: '2026-11-10', nextBookingDate: '2026-11-25' },
  }

  it('shows the stats line (no-show included) and the list with date, time, party and status', () => {
    const html = renderToStaticMarkup(<MemberBookingsSection history={history} />)
    expect(html).toContain('members.bookingsSection')
    for (const [key, value] of [['total', 60], ['confirmed', 20], ['noShow', 3], ['cancelled', 10], ['declined', 5], ['pending', 22]]) {
      expect(html).toMatch(new RegExp(`data-testid="member-bookings-stat-${key}"[^>]*>${value}<`))
    }
    expect(html).toContain('members.bookingStatNoShow')
    expect(html).toMatch(/data-testid="member-bookings-stat-last"[^>]*>Nov 10, 2026</)
    expect(html).toMatch(/data-testid="member-bookings-stat-next"[^>]*>Nov 25, 2026</)
    expect(html).toContain('data-testid="member-booking-row-m1"')
    expect(html).toContain('19:30 · bookings.pax:{&quot;count&quot;:4}')
    expect(html).toContain('bookings.status.no_show')
    expect(html).toContain('members.bookingsShownOf:{&quot;shown&quot;:2,&quot;total&quot;:60}')
  })

  it('no bookings → the empty line; unreadable → the unavailable line; never both', () => {
    const empty = renderToStaticMarkup(
      <MemberBookingsSection history={{ bookings: [], stats: { ...history.stats, total: 0, confirmed: 0, cancelled: 0, declined: 0, noShow: 0, pending: 0, lastBookingDate: null, nextBookingDate: null } }} />
    )
    expect(empty).toContain('data-testid="member-bookings-empty"')
    expect(empty).not.toContain('member-bookings-stats')
    const unavailable = renderToStaticMarkup(<MemberBookingsSection history={null} />)
    expect(unavailable).toContain('data-testid="member-bookings-unavailable"')
    expect(unavailable).not.toContain('member-bookings-empty')
  })

  it('no "showing the latest" line when every booking is listed', () => {
    const html = renderToStaticMarkup(<MemberBookingsSection history={{ ...history, stats: { ...history.stats, total: 2 } }} />)
    expect(html).not.toContain('bookingsShownOf')
  })
})

describe.each(Object.keys(views))('BOOK-008 member link in the %s', (name) => {
  it('a linked booking\'s name is a button that opens its member; an unlinked one is plain text', () => {
    const html = withMembers(views[name]())
    expect(html).toContain('data-testid="booking-row-ln-member"')
    expect(html).toContain('Diner ln')
    expect(html).not.toContain('data-testid="booking-row-un-member"')
    expect(html).toContain('Diner un')
  })

  it('offers Link member on an unlinked booking, Change member and Unlink member on a linked one', () => {
    const html = withMembers(views[name]())
    expect(html).toMatch(/data-testid="booking-row-un-member-link"[^>]*>bookings\.linkMember</)
    expect(html).not.toContain('data-testid="booking-row-un-member-unlink"')
    expect(html).toMatch(/data-testid="booking-row-ln-member-link"[^>]*>bookings\.changeMember</)
    expect(html).toMatch(/data-testid="booking-row-ln-member-unlink"[^>]*>bookings\.unlinkMember</)
  })

  it('outside the Bookings screen (no member context): plain names, no link control', () => {
    const html = withMembers(views[name](), null)
    expect(html).not.toMatch(/booking-row-\w+-member/)
  })
})

describe('BOOK-008 handlers', () => {
  it('clicking the name opens the panel for that booking\'s member', () => {
    const value = actions()
    const el = capture(() => BookingGuestName({ booking: linked }), value) as unknown as AnyProps
    el.props.onClick?.()
    expect(value.opened).toEqual([MEMBER])
  })

  it('Unlink calls the link with null; a busy row disables both buttons', () => {
    const value = actions()
    const el = capture(() => MemberLinkControl({ booking: linked }), value)
    findBy(el, 'data-testid', 'booking-row-ln-member-unlink')?.props.onClick?.()
    expect(value.links).toEqual([['ln', null]])
    const busy = withMembers(<MemberLinkControl booking={linked} />, { ...actions(), busyIds: new Set(['ln']) })
    expect(busy.match(/disabled=""/g)).toHaveLength(2)
  })

  it('search results: picking a member links it; the current member cannot be picked; loading / empty / failed lines', () => {
    const picked: string[] = []
    const state: MemberSearchState = {
      kind: 'results',
      members: [{ id: MEMBER, name: 'Member One', phone: '+85290000001' }, { id: 'other', name: null, phone: '+85290000002' }],
    }
    const el = capture(() => SearchResults({ bookingId: 'ln', state, currentId: MEMBER, onPick: (id) => void picked.push(id) }), actions())
    const html = renderToStaticMarkup(el as ReactElement)
    expect(html).toMatch(/data-testid="booking-row-ln-member-option-5d1b0c2e[^"]*"[^>]*disabled/)
    expect(html).toContain('+85290000002')
    findBy(el, 'member', state.members[1])?.props.onPick?.()
    expect(picked).toEqual(['other'])
    for (const [kind, testId] of [['loading', 'loading'], ['failed', 'error']] as const) {
      expect(renderToStaticMarkup(<SearchResults bookingId="ln" state={{ kind }} currentId={null} onPick={() => {}} />)).toContain(`booking-row-ln-member-search-${testId}`)
    }
    expect(renderToStaticMarkup(<SearchResults bookingId="ln" state={{ kind: 'results', members: [] }} currentId={null} onPick={() => {}} />)).toContain('booking-row-ln-member-search-empty')
  })

  it('the failure notice shows only after a link that did not go through', () => {
    expect(renderToStaticMarkup(<MemberLinkNoticeLine failed={false} />)).toBe('')
    expect(renderToStaticMarkup(<MemberLinkNoticeLine failed />)).toContain('data-testid="booking-member-link-notice"')
  })
})

describe('BOOK-008 member calls', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('searches the tenant member list by name or phone, a small page, mapped to id/name/phone', async () => {
    expect(memberSearchUrl(' +852 9000 ')).toBe('/api/dashboard/members?search=%2B852+9000&pageSize=8&sortBy=name&sortOrder=asc')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ members: [{ id: MEMBER, name: 'M', phone: '+85290000001', points_balance: 3 }] })))
    expect(await searchMembers('M')).toEqual([{ id: MEMBER, name: 'M', phone: '+85290000001' }])
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }))
    expect(await searchMembers('M')).toBeNull()
  })

  it('debounces: an empty query is idle, a newer query cancels the older answer', async () => {
    vi.useFakeTimers()
    const states: MemberSearchState[] = []
    const search = vi.fn(async (q: string) => [{ id: q, name: q, phone: '+852' }])
    startMemberSearch('  ', (s) => states.push(s), search)
    const cancel = startMemberSearch('old', (s) => states.push(s), search)
    cancel()
    startMemberSearch('new', (s) => states.push(s), search)
    await vi.advanceTimersByTimeAsync(300)
    expect(search.mock.calls).toEqual([['new']])
    expect(states).toEqual([
      { kind: 'idle' }, { kind: 'loading' }, { kind: 'loading' },
      { kind: 'results', members: [{ id: 'new', name: 'new', phone: '+852' }] },
    ])
  })

  it('link / unlink is PATCH .../member with { memberId }; outcomes by status', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ booking: { id: 'ln' } })))
    expect(await requestMemberLink('ln', MEMBER)).toEqual({ kind: 'done' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/dashboard/bookings/ln/member')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ memberId: MEMBER }) })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ booking: { id: 'ln' } })))
    await requestMemberLink('ln', null)
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ body: '{"memberId":null}' })
    expect(memberLinkOutcome(404, { error: 'not_found' })).toEqual({ kind: 'not_found' })
    expect(memberLinkOutcome(409, { error: 'changed' })).toEqual({ kind: 'changed' })
    expect(memberLinkOutcome(500, null)).toEqual({ kind: 'error' })
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await requestMemberLink('ln', null)).toEqual({ kind: 'error' })
  })

  it('every link refreshes the list; the row is busy until then; a refused one shows the notice', async () => {
    let busy: ReadonlySet<string> = new Set()
    const seen: string[][] = []
    const failed: boolean[] = []
    const refetch = vi.fn(async () => void seen.push([...busy]))
    const sinks = { setBusy: (u: (p: ReadonlySet<string>) => ReadonlySet<string>) => void (busy = u(busy)), setFailed: (f: boolean) => void failed.push(f), refetch }
    await memberLinkAction(sinks, async () => ({ kind: 'done' }))('ln', MEMBER)
    await memberLinkAction(sinks, async () => ({ kind: 'changed' }))('ln', null)
    expect(refetch).toHaveBeenCalledTimes(2)
    expect(seen).toEqual([['ln'], ['ln']])
    expect([...busy]).toEqual([])
    expect(failed).toEqual([false, false, false, true])
  })
})

describe('BOOK-008 messages', () => {
  const keys = {
    members: ['bookingsSection', 'bookingsUnavailable', 'noBookings', 'bookingStatTotal', 'bookingStatConfirmed', 'bookingStatNoShow', 'bookingStatCancelled', 'bookingStatDeclined', 'bookingStatPending', 'lastBooking', 'nextBooking', 'bookingsShownOf'],
    bookings: ['viewMember', 'linkMember', 'changeMember', 'unlinkMember', 'memberSearchLabel', 'memberSearchPlaceholder', 'memberSearching', 'memberSearchEmpty', 'memberSearchFailed', 'memberLinkFailed'],
  } as const
  it.each([['en', en], ['zh-HK', zhHK]] as const)('%s has every new string', (_locale, messages) => {
    for (const [ns, list] of Object.entries(keys)) {
      for (const key of list) expect((messages as unknown as Record<string, Record<string, string>>)[ns][key], `${ns}.${key}`).toBeTruthy()
    }
    expect(zhHK.bookings.linkMember).toBe('連結會員')
  })
})
