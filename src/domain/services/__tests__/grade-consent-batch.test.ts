// WONB-004: parametric test for the Q-B auto-grading decision table.
// Each row mirrors a row of the table in `docs/tasks/wonb-004-plan.md` so
// that any future change to the plan must be reflected here first.

import { describe, it, expect } from 'vitest'
import { gradeConsent } from '../grade-consent-batch'
import type { ConsentChannel } from '@/domain/value-objects/consent-channel'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'

const NOW = new Date('2026-05-04T12:00:00.000Z')

// Helper: yyyy-mm-dd offsets relative to NOW.
function monthsAgo(months: number): Date {
  const d = new Date(NOW)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d
}

const WITHIN_12 = monthsAgo(6)            // ≤12mo old → "yes" col 1
const WITHIN_24 = monthsAgo(18)           // 12–24mo old → "no" col 1, "yes" col 2
const OLDER_24 = monthsAgo(30)            // >24mo old  → "no" both
const TEXT_WITH_WA = 'I agree to receive marketing via WhatsApp from Demo'
const TEXT_NO_WA = 'I agree to receive marketing messages from Demo Cafe'

interface Case {
  name: string
  channel: ConsentChannel
  dateRangeEnd: Date
  consentTextShown: string
  expected: ConsentGrade
}

const CASES: Case[] = [
  // --- whatsapp channel ---
  {
    name: 'whatsapp + recent + mentions WhatsApp → strong',
    channel: 'whatsapp',
    dateRangeEnd: WITHIN_12,
    consentTextShown: TEXT_WITH_WA,
    expected: 'strong',
  },
  {
    name: 'whatsapp + 12-24mo + mentions WhatsApp → medium',
    channel: 'whatsapp',
    dateRangeEnd: WITHIN_24,
    consentTextShown: TEXT_WITH_WA,
    expected: 'medium',
  },
  {
    name: 'whatsapp + >24mo old → none (regardless of text/recency col)',
    channel: 'whatsapp',
    dateRangeEnd: OLDER_24,
    consentTextShown: TEXT_WITH_WA,
    expected: 'none',
  },
  {
    name: 'whatsapp + recent but text omits WhatsApp → medium',
    channel: 'whatsapp',
    dateRangeEnd: WITHIN_12,
    consentTextShown: TEXT_NO_WA,
    expected: 'medium',
  },
  // --- generic channel ---
  {
    name: 'generic + recent → medium',
    channel: 'generic',
    dateRangeEnd: WITHIN_12,
    consentTextShown: TEXT_NO_WA,
    expected: 'medium',
  },
  {
    name: 'generic + 12-24mo → weak',
    channel: 'generic',
    dateRangeEnd: WITHIN_24,
    consentTextShown: TEXT_NO_WA,
    expected: 'weak',
  },
  {
    name: 'generic + >24mo → none',
    channel: 'generic',
    dateRangeEnd: OLDER_24,
    consentTextShown: TEXT_NO_WA,
    expected: 'none',
  },
  // --- service_only / none channels ---
  {
    name: 'service_only is always weak (utility templates only)',
    channel: 'service_only',
    dateRangeEnd: WITHIN_12,
    consentTextShown: TEXT_NO_WA,
    expected: 'weak',
  },
  {
    name: 'none is always grade=none',
    channel: 'none',
    dateRangeEnd: WITHIN_12,
    consentTextShown: TEXT_NO_WA,
    expected: 'none',
  },
]

describe('gradeConsent — Q-B decision table', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(
        gradeConsent({
          channel: c.channel,
          consentTextShown: c.consentTextShown,
          dateRangeEnd: c.dateRangeEnd,
          now: NOW,
        })
      ).toBe(c.expected)
    })
  }

  it('detects "WhatsApp" mention case-insensitively', () => {
    for (const text of ['whatsapp', 'WHATSAPP', 'WhatsApp', 'whatsApp']) {
      const grade = gradeConsent({
        channel: 'whatsapp',
        dateRangeEnd: WITHIN_12,
        consentTextShown: `I agree via ${text}`,
        now: NOW,
      })
      expect(grade).toBe('strong')
    }
  })
})
