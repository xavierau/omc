// BOOK-014 W6a (spec UI Feedback States, AI agent row: "Lapsed: agent says the
// hold lapsed and offers to start again"): when a hold lapses (the cron's
// expireDeposits, or the provider's "session expired" event), a booking made
// by the WhatsApp AI agent gets one fixed text in the diner's language: the
// hold lapsed, nothing was charged, reply to start again, with the tenant's
// AI disclosure. Personal-agent (PAP) and booking page holds send nothing new.
// A send failure is logged, never retried, and never stops the expiry batch.
import { describe, it, expect } from 'vitest'
import { paymentWorld, RESTAURANT } from '@/test-utils/payment-world'
import type { LanguageCode } from '@/domain/value-objects/language'
import type { LapsedHoldBooking } from '@/domain/ports/booking-deposit'
import { expireDeposits } from '../expire-deposits'
import { processPaymentWebhook } from '../process-payment-webhook'
import { agentHoldLapsedNotice } from '../notify-agent-hold-lapsed'

const HOLD_MS = 31 * 60_000
const DISCLOSURE = '（AI 助理 AI assistant）'

function setup() {
  const w = paymentWorld()
  const personalAgent = new Set<string>()
  const languages = new Map<string, LanguageCode>()
  const sent: Array<{ restaurantId: string; phone: string; text: string }> = []
  const reads: number[] = []
  let failFor: string | null = null
  let readerFails = false
  const notice = agentHoldLapsedNotice({
    bookings: {
      async findForDeposits(refs) {
        if (readerFails) throw new Error('db down')
        reads.push(refs.length)
        return refs.flatMap(({ restaurantId, bookingId }): LapsedHoldBooking[] => {
          const b = w.ledger.booking(bookingId)
          if (!b || b.restaurantId !== restaurantId) return []
          return [{ id: b.id, restaurantId: b.restaurantId, phone: b.phone, source: b.source, personalAgent: personalAgent.has(b.id), bookingDate: b.bookingDate, bookingTime: b.bookingTime, partySize: b.partySize }]
        })
      },
    },
    language: async (_r, phone) => languages.get(phone) ?? 'zh_hk',
    disclosure: async () => DISCLOSURE,
    sendText: async (restaurantId, phone, text) => {
      if (phone === failFor) throw new Error('kapso down')
      sent.push({ restaurantId, phone, text })
      return true
    },
    log: w.log,
  })
  const expire = () => expireDeposits({ ...w.expireDeps, onLapsed: notice })
  return {
    w, sent, reads, personalAgent, languages, expire, notice,
    failSendTo: (phone: string) => void (failFor = phone),
    failReader: () => void (readerFails = true),
  }
}

async function hold(w: ReturnType<typeof paymentWorld>, over: Parameters<typeof w.book>[0]) {
  const s = await w.book(over)
  if (s.kind !== 'started') throw new Error(s.kind)
  return s
}

describe('W6a AI-agent hold lapse text', () => {
  it('AI agent hold lapses -> one zh-HK text (default language) with the slot, "nothing charged", reply to start again, the disclosure', async () => {
    const { w, sent, expire } = setup()
    await hold(w, { source: 'agent', partySize: 4 })
    w.advance(HOLD_MS)
    const result = await expire()
    expect(result.depositsLapsed).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0].restaurantId).toBe(RESTAURANT)
    expect(sent[0].phone).toBe('+85291234567')
    expect(sent[0].text).toContain('2026-12-24 19:00')
    expect(sent[0].text).toContain('未有收取任何款項')
    expect(sent[0].text).toContain('回覆')
    expect(sent[0].text).not.toContain('nothing was charged')
    expect(sent[0].text.endsWith(DISCLOSURE)).toBe(true)
  })

  it('an English-speaking diner gets the English text', async () => {
    const { w, sent, expire, languages } = setup()
    languages.set('+85291234567', 'en')
    await hold(w, { source: 'agent', partySize: 2 })
    w.advance(HOLD_MS)
    await expire()
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('has lapsed')
    expect(sent[0].text).toContain('nothing was charged')
    expect(sent[0].text).toContain('Reply')
    expect(sent[0].text).toContain('2 on 2026-12-24 at 19:00')
    expect(sent[0].text).not.toContain('未有收取')
  })

  it('sent once: the next expiry run sends nothing more', async () => {
    const { w, sent, expire } = setup()
    await hold(w, { source: 'agent' })
    w.advance(HOLD_MS)
    await expire()
    await expire()
    expect(sent).toHaveLength(1)
  })

  it('PAP (personal agent), booking page and campaign holds lapse and send nothing new', async () => {
    const { w, sent, expire, personalAgent } = setup()
    const pap = await hold(w, { source: 'agent', phone: '+85291000001', partySize: 2 })
    personalAgent.add(pap.booking.id)
    await hold(w, { source: 'chat', phone: '+85291000002', partySize: 2 })
    await hold(w, { source: 'campaign', phone: '+85291000003', partySize: 2 })
    w.advance(HOLD_MS)
    expect((await expire()).depositsLapsed).toBe(3)
    expect(sent).toEqual([])
  })

  it('a send failure is logged, not retried, and the other diner still gets the text; the batch result stands', async () => {
    const { w, sent, expire, failSendTo } = setup()
    await hold(w, { source: 'agent', phone: '+85291000001', partySize: 2 })
    await hold(w, { source: 'agent', phone: '+85291000002', partySize: 2 })
    failSendTo('+85291000001')
    w.advance(HOLD_MS)
    const result = await expire()
    expect(result.depositsLapsed).toBe(2)
    expect(sent.map((s) => s.phone)).toEqual(['+85291000002'])
    expect(w.lines.filter((l) => l.event === 'deposit.lapse_notice_failed')).toHaveLength(1)
    await expire()
    expect(sent).toHaveLength(1)
  })

  it('a booking read failure is logged and never stops the expiry batch', async () => {
    const { w, sent, expire, failReader } = setup()
    const s = await hold(w, { source: 'agent' })
    failReader()
    w.advance(HOLD_MS)
    const result = await expire()
    expect(result.depositsLapsed).toBe(1)
    expect(w.ledger.booking(s.booking.id)?.status).toBe('lapsed')
    expect(sent).toEqual([])
    expect(w.lines.some((l) => l.event === 'deposit.lapse_notice_failed')).toBe(true)
  })

  it('nothing lapsed -> no booking read, no text', async () => {
    const { w, sent, reads, expire } = setup()
    await hold(w, { source: 'agent' })
    await expire()
    expect(reads).toEqual([])
    expect(sent).toEqual([])
  })

  it('the provider "session expired" event lapses an AI hold -> the same text once (replay none)', async () => {
    const { w, sent, notice } = setup()
    const s = await hold(w, { source: 'agent' })
    w.advance(HOLD_MS)
    const delivery = w.gateway.expireSession(s.deposit.providerSessionId!)
    const deps = { ...w.webhookDeps, onLapsed: notice }
    await processPaymentWebhook(deps, delivery)
    await processPaymentWebhook(deps, delivery)
    expect(w.ledger.booking(s.booking.id)?.status).toBe('lapsed')
    expect(sent).toHaveLength(1)
  })
})
