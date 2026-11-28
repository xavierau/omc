// BOOK-014 W5 (spec AC-10, AC-3; threat R61, R62, R64): the personal agent's
// documents and status route when the restaurant takes deposits. The real
// route handlers over fake ports (booking-deps mocked, as the other poppy
// route tests). With BOOK014_W5_EVIDENCE_DIR set, the rendered openapi.json
// and poppy.json are also written there (AC-3 evidence for the lint runs).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeAccounts } from '@/test-utils/fake-booking-deposit'
import { paymentWorld } from '@/test-utils/payment-world'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from '@/application/booking/__tests__/fake-agent-booking'
import { createAgentBooking, type CreateAgentBookingDeps } from '@/application/booking/create-agent-booking'
import { verifyAgentBooking } from '@/application/booking/verify-agent-booking'
import { generatePoppyJson } from '@/application/booking/agent-booking-settings'
import type { GetAgentBookingStatusDeps } from '@/application/booking/get-agent-booking-status'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

const holder: { status: GetAgentBookingStatusDeps | null; openapi: unknown } = { status: null, openapi: null }
vi.mock('@/application/booking/booking-deps', () => ({
  getAgentBookingStatusDeps: () => holder.status,
  agentOpenApiDeps: () => holder.openapi,
}))

import { GET as GET_STATUS } from '../[publicId]/bookings/[id]/route'
import { GET as GET_OPENAPI } from '../[publicId]/openapi.json/route'

const A = 'rest-a'
const PID = 'A'.repeat(32)
const PHONE = '+85291234567'
const PRIVACY = 'https://ohmyclient.io/privacy-policy.html'
const APP = 'https://app.ohmyclient.io'
const RULE: DepositRule = {
  enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 2,
  refundNote: { zh_hk: '取消須提前24小時通知。', en: 'Cancel 24 hours ahead for a refund.' },
}
const TERMS_EN = 'Deposit HK$100 per guest for 2 or more. Cancel 24 hours ahead for a refund.'
const STRIPE_EN = 'The deposit is processed by Stripe for Cafe A; Stripe may process your payment details outside Hong Kong.'
const STRIPE_ZH = '訂金由 Stripe 代Cafe A處理，Stripe 或會在香港以外地方處理你的付款資料。'

let clock: FakeClock
let directory: FakeAgentDirectory
let settings: FakeBookingSettings
let accounts: FakeAccounts

function tenant(patch: Partial<BookingConfig>) {
  directory.tenants.clear()
  const config = directory.add(A, PID, { maxPartySize: 8, ...patch }, { websiteHost: 'www.cafe-a.hk' })
  settings.configs.set(A, config)
}

beforeEach(() => {
  clock = new FakeClock(new Date('2026-11-19T02:00:00.000Z'))
  directory = new FakeAgentDirectory()
  settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  accounts = new FakeAccounts()
  accounts.set({ restaurantId: A })
  tenant({ deposit: RULE })
  holder.openapi = { directory, settings, appUrl: APP, privacyUrl: PRIVACY, now: () => clock.now(), accounts }
})

const openapi = async () => (await GET_OPENAPI(new Request('https://x'), { params: Promise.resolve({ publicId: PID }) })).json()
const poppy = () =>
  generatePoppyJson(
    { getConfig: (id) => settings.getConfig(id), changeConfig: async () => null, settings, secrets: { publicId: () => PID }, appUrl: APP, accounts },
    A
  )

function evidence(name: string, doc: unknown) {
  const dir = process.env.BOOK014_W5_EVIDENCE_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), `${JSON.stringify(doc, null, 2)}\n`)
}

describe('AC-10: OpenAPI and poppy.json state the deposit while it is active', () => {
  it('openapi.json: awaiting_deposit in the status enum, payment_url, deposit{amount,currency,expires_at}, the rule and R61', async () => {
    const doc = await openapi()
    evidence('openapi.json', doc)
    const status = doc.components.schemas.BookingStatus
    expect(status.properties.status.enum).toContain('awaiting_deposit')
    expect(doc.components.schemas.CreatedBooking.properties.status.enum).toContain('awaiting_deposit')
    expect(status.properties.payment_url).toMatchObject({ type: 'string', format: 'uri' })
    expect(status.properties.deposit).toMatchObject({ type: 'object', required: ['amount', 'currency', 'expires_at'] })
    expect(Object.keys(status.properties.deposit.properties)).toEqual(['amount', 'currency', 'expires_at'])
    const text: string = doc.info.description
    expect(text).toContain(`Deposit: ${TERMS_EN}`)
    expect(text).toContain('the booking becomes `awaiting_deposit` and the diner gets a payment link in that WhatsApp chat')
    expect(text).toContain(STRIPE_EN)
    expect(text).toContain(STRIPE_ZH)
    // R59: still no request field for a deposit or an amount.
    const body = doc.paths['/bookings'].post.requestBody.content['application/json'].schema
    expect(body.additionalProperties).toBe(false)
    expect(Object.keys(body.properties).filter((k) => /deposit|amount|pay|waiv|refund/i.test(k))).toEqual([])
  })

  it('poppy.json: the api description says a deposit is required and its amount rule', async () => {
    const result = await poppy()
    if (!result.ok) throw new Error(result.reason)
    evidence('poppy.json', result.document)
    expect(result.document.apis[0].description).toBe(
      `Request a table at Cafe A. The diner confirms the request on WhatsApp. A deposit is required: ${TERMS_EN} After the diner confirms on WhatsApp, they get a payment link there; the request goes to the restaurant once it is paid.`
    )
  })

  it('rule off or account not Active: both documents are the pre-BOOK-014 ones, byte for byte', async () => {
    tenant({})
    const off = await openapi()
    const offPoppy = await poppy()
    accounts.set({ restaurantId: A, chargesEnabled: false })
    tenant({ deposit: RULE })
    expect(await openapi()).toEqual(off)
    expect(await poppy()).toEqual(offPoppy)
    holder.openapi = { directory, settings, appUrl: APP, privacyUrl: PRIVACY, now: () => clock.now() }
    expect(await openapi()).toEqual(off)
    expect(JSON.stringify(off)).not.toContain('awaiting_deposit')
    expect(JSON.stringify(off)).not.toContain('Stripe')
  })
})

describe('AC-10: GET /bookings/{id} while awaiting the deposit', () => {
  it('awaiting_deposit with payment_url and deposit{}; no phone, name or provider detail', async () => {
    const pay = paymentWorld(new Date('2026-11-19T02:00:00.000Z'))
    const store = new FakeAgentBookingStore()
    store.createdAt = () => clock.now()
    const createDeps: CreateAgentBookingDeps = {
      directory, store, settings, limiter: new FakeRateLimiter(clock), secrets: scriptedSecrets(['K7PX3M']), privacyUrl: PRIVACY, now: () => clock.now(),
    }
    const created = await createAgentBooking(createDeps, {
      publicId: PID, body: { date: '2026-11-20', time: '19:30', party_size: 4, name: 'Chan Tai Man', phone: PHONE }, clientIp: '1.1.1.1', idempotencyKey: null,
    })
    if (!created.ok || created.kind !== 'awaiting_confirmation') throw new Error('create failed')
    await verifyAgentBooking(
      {
        store, members: { findMemberId: async () => null }, settings, sender: { send: async () => ({ delivered: true, via: 'text' }) },
        sendText: async () => {}, privacyUrl: PRIVACY, now: () => clock.now(),
        deposit: { accounts: pay.accounts, start: pay.startDeps, promoter: store.depositPromoter(pay.ledger) },
      },
      { restaurantId: A, phone: PHONE, text: 'K7PX3M', wamid: 'w1' }
    )
    holder.status = { directory, store, now: () => clock.now(), deposits: { store: pay.ledger, registry: pay.registry } }
    const res = await GET_STATUS(
      new NextRequest(`${APP}/api/poppy/${PID}/bookings/${created.body.booking_id}`, { headers: { 'x-booking-status-token': created.body.status_token } }),
      { params: Promise.resolve({ publicId: PID, id: created.body.booking_id }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    evidence('status-awaiting-deposit.json', body)
    const [deposit] = [...pay.ledger.deposits.values()]
    expect(body).toEqual({
      booking_id: created.body.booking_id, status: 'awaiting_deposit', date: '2026-11-20', time: '19:30', party_size: 4,
      payment_url: deposit.sessionUrl, deposit: { amount: '400', currency: 'HKD', expires_at: deposit.holdExpiresAt },
    })
    expect(JSON.stringify(body)).not.toMatch(/Chan|\+852|acct_/)
  })
})
