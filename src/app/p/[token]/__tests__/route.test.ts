// BOOK-014 (threat R62): GET /p/<token>. An open hold -> 303 to the stored
// hosted page; short / unknown / expired / lapsed -> a neutral 404 / 410 page
// with no booking details; a stored URL on another host -> no redirect; the
// booking security headers on every answer.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { paymentWorld } from '@/test-utils/payment-world'

const holder = vi.hoisted(() => ({ deps: null as unknown }))
vi.mock('@/application/payments/payment-deps', () => ({ paymentLinkDeps: () => holder.deps }))

import { GET } from '../route'

let w: ReturnType<typeof paymentWorld>

beforeEach(() => {
  w = paymentWorld()
  holder.deps = w.linkDeps
})

const get = (token: string, query = '') => GET(new NextRequest(`http://localhost/p/${token}${query}`), { params: Promise.resolve({ token }) })

function expectSecurityHeaders(res: Response) {
  expect(res.headers.get('cache-control')).toContain('no-store')
  expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  expect(res.headers.get('x-robots-tag')).toContain('noindex')
}

async function expectNeutral(res: Response, status: number) {
  expect(res.status).toBe(status)
  expectSecurityHeaders(res)
  const html = await res.text()
  for (const detail of ['Café A', 'Chan', '+852', '2026-12-24', '19:00', '400', 'acct_']) expect(html).not.toContain(detail)
  return html
}

async function startedToken() {
  const s = await w.book()
  if (s.kind !== 'started') throw new Error(s.kind)
  return { s, token: w.tokens[0] }
}

describe('R62: /p/<token>', () => {
  it('an open hold -> 303 to the stored hosted-payment URL', async () => {
    const { s, token } = await startedToken()
    const res = await get(token)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(s.deposit.sessionUrl)
    expectSecurityHeaders(res)
  })

  it('short and unknown tokens -> neutral 404, no booking details', async () => {
    await startedToken()
    expect(await expectNeutral(await get('short'), 404)).toContain('Link not valid')
    await expectNeutral(await get('Z'.repeat(43)), 404)
  })

  it('an expired hold -> neutral 410 "lapsed" page', async () => {
    const { token } = await startedToken()
    w.advance(31 * 60_000)
    await w.ledger.lapseExpired(200) // W6-fix F3: lapsed only once the lapse ran (before: checking)
    const html = await expectNeutral(await get(token), 410)
    expect(html).toContain('This hold has lapsed')
    expect(html).toContain('data-testid="booking-pay-lapsed"')
  })

  it('a stored URL on another host -> no redirect (503 neutral page)', async () => {
    const { s, token } = await startedToken()
    w.ledger.deposits.get(s.deposit.id)!.sessionUrl = 'https://evil.example/pay'
    const res = await get(token)
    expect(res.headers.get('location')).toBeNull()
    await expectNeutral(res, 503)
  })

  it('back from the provider: success -> "confirming"; cancel -> "not finished" with Pay now back to /p', async () => {
    const { token } = await startedToken()
    expect(await expectNeutral(await get(token, '?return=success'), 200)).toContain('Confirming your payment')
    const html = await expectNeutral(await get(token, '?return=cancel'), 200)
    expect(html).toContain(`href="/p/${token}"`)
    expect(html).toContain('data-testid="booking-pay-pending"')
  })

  it('a paid deposit -> neutral "Deposit paid" page, no redirect back to the provider', async () => {
    const { s, token } = await startedToken()
    await w.deliver(w.gateway.completeSession(s.deposit.providerSessionId!))
    const res = await get(token)
    expect(res.headers.get('location')).toBeNull()
    expect(await expectNeutral(res, 200)).toContain('Deposit paid, request sent')
  })
})
