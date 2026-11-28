// BOOK-014 W6a (threat R61, PDPO DPP1): the PAP create response's
// collection_statement also carries the Stripe processing and cross-border
// sentence (depositProcessingSentence, the one shared wording) while the
// restaurant takes deposits (rule on and an account that can take charges,
// AC-4). Otherwise the statement is the pre-BOOK-014 one, unchanged.
import { describe, it, expect, beforeEach } from 'vitest'
import { FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeAccounts } from '@/test-utils/fake-booking-deposit'
import { buildCollectionStatement } from '@/domain/services/poppy-documents'
import { depositProcessingSentence } from '@/domain/value-objects/deposit-messages'
import type { DepositRule } from '@/domain/value-objects/deposit-rule'
import { createAgentBooking, type CreateAgentBookingDeps } from '../create-agent-booking'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from './fake-agent-booking'

const R = 'rest-a'
const PID = 'A'.repeat(32)
const BODY = { date: '2026-11-20', time: '19:30', party_size: 4, name: 'Chan Tai Man', phone: '+85291234567' }
const RULE: DepositRule = { enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 6, refundNote: { zh_hk: '', en: '' } }

let clock: FakeClock
let directory: FakeAgentDirectory
let accounts: FakeAccounts
let deps: CreateAgentBookingDeps

function setup(rule: DepositRule | null) {
  clock = new FakeClock(new Date('2026-11-19T02:00:00.000Z'))
  const store = new FakeAgentBookingStore()
  store.createdAt = () => clock.now()
  directory = new FakeAgentDirectory()
  directory.add(R, PID, rule ? { deposit: rule } : {})
  const settings = new FakeBookingSettings()
  settings.restaurants.set(R, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  accounts = new FakeAccounts()
  deps = {
    directory, store, settings, limiter: new FakeRateLimiter(clock), secrets: scriptedSecrets(['K7PX3M', 'K7PX3N']),
    privacyUrl: 'https://p', now: () => clock.now(), accounts,
  }
}

async function statement() {
  const result = await createAgentBooking(deps, { publicId: PID, body: BODY, clientIp: '1.1.1.1', idempotencyKey: null })
  if (!result.ok || result.kind !== 'awaiting_confirmation') throw new Error('create failed')
  return result.body.collection_statement
}

const BASE = buildCollectionStatement('Cafe A', 'https://p')
const STRIPE = depositProcessingSentence('Cafe A')

describe('W6a PAP create collection_statement (R61)', () => {
  beforeEach(() => setup(RULE))

  it('deposit active (rule on, account chargeable) -> both languages end with the Stripe sentence; privacy_url unchanged', async () => {
    accounts.set({ restaurantId: R })
    const s = await statement()
    expect(s.en).toBe(`${BASE.en} ${STRIPE.en}`)
    expect(s['zh-HK']).toBe(`${BASE['zh-HK']}${STRIPE.zh_hk}`)
    expect(s.privacy_url).toBe('https://p')
  })

  it('active even when this party is below N (the statement is about the restaurant taking deposits)', async () => {
    accounts.set({ restaurantId: R })
    expect((await statement()).en).toContain('Stripe')
  })

  it('account not chargeable (restricted, none) -> the pre-BOOK-014 statement', async () => {
    accounts.set({ restaurantId: R, status: 'restricted', chargesEnabled: false })
    expect(await statement()).toEqual(BASE)
    accounts.rows.clear()
    expect(await statement()).toEqual(BASE)
  })

  it('rule off -> the pre-BOOK-014 statement; no account reader -> the same', async () => {
    setup(null)
    accounts.set({ restaurantId: R })
    expect(await statement()).toEqual(BASE)
    setup(RULE)
    deps = { ...deps, accounts: undefined }
    expect(await statement()).toEqual(BASE)
  })
})
