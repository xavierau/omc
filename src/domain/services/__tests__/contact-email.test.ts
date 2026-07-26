import { describe, it, expect } from 'vitest'
import { buildContactEmail } from '../contact-email'

const SUBMISSION = {
  clientName: '陳大文',
  clientWhatsapp: '+852 9123 4567',
  topic: '訂座查詢',
}

const CONTEXT = {
  senderWaId: '85291234567',
  contactName: 'Tai Man Chan',
  restaurantName: 'Cafe Latte',
  restaurantWhatsappNumber: '+852 2345 6789',
  timestamp: new Date('2026-07-26T10:30:00Z'),
  messageId: 'wamid.HBgLODUyOTEyMzQ1NjcVAgARGBI',
}

describe('buildContactEmail', () => {
  it('sets the subject with the restaurant name', () => {
    const { subject } = buildContactEmail(SUBMISSION, CONTEXT)
    expect(subject).toBe('[OhMyClient] 新客戶查詢 — Cafe Latte')
  })

  it('includes every submitted field', () => {
    const { text } = buildContactEmail(SUBMISSION, CONTEXT)
    expect(text).toContain('陳大文')
    expect(text).toContain('+852 9123 4567')
    expect(text).toContain('訂座查詢')
  })

  it('includes every WhatsApp context field', () => {
    const { text } = buildContactEmail(SUBMISSION, CONTEXT)
    expect(text).toContain('85291234567')
    expect(text).toContain('Tai Man Chan')
    expect(text).toContain('Cafe Latte')
    expect(text).toContain('+852 2345 6789')
    expect(text).toContain('wamid.HBgLODUyOTEyMzQ1NjcVAgARGBI')
    // HK-local rendering of 2026-07-26T10:30:00Z => 2026-07-26 18:30 HKT
    expect(text).toContain('2026-07-26')
    expect(text).toContain('18:30')
  })

  it('omits the profile name gracefully when not provided', () => {
    const { text } = buildContactEmail(SUBMISSION, { ...CONTEXT, contactName: undefined })
    expect(text).not.toContain('undefined')
  })

  it('shows both numbers as two distinct labelled lines when they match (no marker)', () => {
    const { text } = buildContactEmail(
      { ...SUBMISSION, clientWhatsapp: '+852 9123 4567' },
      { ...CONTEXT, senderWaId: '85291234567' }
    )
    // both raw strings appear as separate lines
    expect(text).toContain('+852 9123 4567')
    expect(text).toContain('85291234567')
    expect(text).not.toContain('⚠️')
  })

  it('adds a mismatch marker on both lines when normalized digits differ', () => {
    const { text } = buildContactEmail(
      { ...SUBMISSION, clientWhatsapp: '+852 9123 4567' },
      { ...CONTEXT, senderWaId: '85298887777' }
    )
    const markerCount = text.split('⚠️').length - 1
    expect(markerCount).toBe(2)
  })

  it('treats "+852 9123 4567" and "85291234567" as equal (no marker)', () => {
    const { text } = buildContactEmail(
      { ...SUBMISSION, clientWhatsapp: '+852 9123 4567' },
      { ...CONTEXT, senderWaId: '85291234567' }
    )
    expect(text).not.toContain('⚠️')
  })
})
