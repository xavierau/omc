import { describe, it, expect } from 'vitest'
import { buildContactEmail } from '../contact-email'
import { DEFAULT_LABELS } from '../contact-config'

// Peter holds the handset; Lily is who the enquiry is about. Keeping them
// different throughout is the point: the two sections describe two people, and
// nothing in the email should conflate them.
const SUBMISSION = {
  clientName: 'Lily',
  clientWhatsapp: '69879886',
  topic: '汽車保險',
}

const LABELS = {
  title: '保險查詢',
  nameLabel: '客戶姓名',
  phoneLabel: '聯絡電話',
  topicLabel: '保險類別',
  submitLabel: '提交',
}

const CONTEXT = {
  senderWaId: '+85291234123',
  contactName: 'Peter Chan',
  timestamp: new Date('2026-07-26T10:30:00Z'),
  labels: LABELS,
}

describe('buildContactEmail', () => {
  // The notification goes to one tenant's own configured address, so naming
  // the restaurant back to itself is noise — it read
  // "[OhMyClient] 新客戶查詢 — OhMyClient" for a tenant whose name matches the
  // product's.
  it('uses a plain subject carrying no tenant identity', () => {
    const { subject } = buildContactEmail(SUBMISSION, CONTEXT)
    expect(subject).toBe('新客戶查詢')
  })

  describe('part one — the form as filled in', () => {
    // "use exact the input label": a tenant who renamed their fields must see
    // their own words, not our defaults.
    it("reads back under the tenant's own labels, not the shipped defaults", () => {
      const { text } = buildContactEmail(SUBMISSION, CONTEXT)

      expect(text).toContain('保險查詢:')
      expect(text).toContain('客戶姓名: Lily')
      expect(text).toContain('聯絡電話: 69879886')
      expect(text).toContain('保險類別: 汽車保險')
      // Checked on the topic label: the shipped 姓名/WhatsApp 號碼 are also the
      // sender section's own fixed labels, so their absence can't be asserted
      // globally — and 客戶姓名 contains 姓名 as a substring anyway.
      expect(text).not.toContain(DEFAULT_LABELS.topicLabel)
    })

    it('carries the submitted values verbatim', () => {
      const { text } = buildContactEmail(SUBMISSION, CONTEXT)
      const partOne = text.split('提交查詢的會員:')[0]

      expect(partOne).toContain('Lily')
      expect(partOne).toContain('69879886')
      expect(partOne).toContain('汽車保險')
    })

    it('falls back to the shipped labels for a tenant who customised nothing', () => {
      const { text } = buildContactEmail(SUBMISSION, { ...CONTEXT, labels: DEFAULT_LABELS })

      expect(text).toContain(`${DEFAULT_LABELS.nameLabel}: Lily`)
      expect(text).toContain(`${DEFAULT_LABELS.topicLabel}: 汽車保險`)
    })
  })

  describe('part two — who submitted it', () => {
    it('reports the sending member, not the person the enquiry is about', () => {
      const { text } = buildContactEmail(SUBMISSION, CONTEXT)
      const partTwo = text.split('提交查詢的會員:')[1]

      expect(partTwo).toContain('姓名: Peter Chan')
      expect(partTwo).toContain('WhatsApp 號碼: +85291234123')
      expect(partTwo).not.toContain('Lily')
      expect(partTwo).not.toContain('69879886')
    })

    // Fixed labels here on purpose: this section is our record of the sender,
    // not a read-back of their form, so borrowing the form's labels would
    // imply the two describe the same person.
    it('labels the sender section independently of the tenant labels', () => {
      const { text } = buildContactEmail(SUBMISSION, CONTEXT)
      const partTwo = text.split('提交查詢的會員:')[1]

      expect(partTwo).not.toContain(LABELS.nameLabel)
      expect(partTwo).not.toContain(LABELS.phoneLabel)
    })

    it('renders the timestamp in Hong Kong time', () => {
      const { text } = buildContactEmail(SUBMISSION, CONTEXT)
      // 2026-07-26T10:30:00Z => 18:30 HKT
      expect(text).toContain('2026-07-26')
      expect(text).toContain('18:30')
    })

    it('says so plainly when the sender has no name on record', () => {
      const { text } = buildContactEmail(SUBMISSION, { ...CONTEXT, contactName: undefined })

      expect(text).toContain('姓名: (未提供)')
      expect(text).not.toContain('undefined')
    })
  })

  // A member enquiring for a family member, a colleague, or a customer is the
  // ordinary case, not a discrepancy. An earlier version flagged any
  // difference with ⚠️ 填寫號碼與傳送號碼不同, which made the normal thing look
  // suspicious; two clearly separated sections say it without the false alarm.
  it('never flags the submitted and sending numbers differing', () => {
    const { text } = buildContactEmail(SUBMISSION, CONTEXT)

    expect(text).not.toContain('⚠️')
    expect(text).not.toContain('不同')
  })

  it('is equally unremarkable when the two numbers happen to match', () => {
    const { text } = buildContactEmail({ ...SUBMISSION, clientWhatsapp: '+85291234123' }, CONTEXT)

    expect(text).not.toContain('⚠️')
  })

  it('names no restaurant anywhere in the body', () => {
    const { text } = buildContactEmail(SUBMISSION, CONTEXT)
    expect(text).not.toContain('餐廳')
  })

  it('renders the two sections in order, separated by a blank line', () => {
    const { text } = buildContactEmail(SUBMISSION, CONTEXT)

    expect(text.indexOf('保險查詢:')).toBeLessThan(text.indexOf('提交查詢的會員:'))
    expect(text).toContain('汽車保險\n\n提交查詢的會員:')
  })
})
