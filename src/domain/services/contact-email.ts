/**
 * REPLY-005: pure formatter for the "contact us" notification email.
 * Zero infra imports — the webhook handler (Stream D) builds context and
 * calls `EmailPort.send` with this output.
 */
import type { ContactLabels } from './contact-config'

export interface ContactFormSubmission {
  clientName: string
  clientWhatsapp: string
  topic: string
}

/**
 * Deliberately carries NO tenant identity (name / WhatsApp number). The
 * notification is sent to one tenant's own configured address, so naming the
 * restaurant back to itself is noise in every line it appears — including the
 * subject, which read "[OhMyClient] 新客戶查詢 — OhMyClient" for a tenant whose
 * name matches the product's.
 */
/**
 * WHO SENT the enquiry — not who it is about. The person holding the WhatsApp
 * handset may well be submitting on someone else's behalf (a member enquiring
 * for a family member, a colleague, a customer), so this is reported as its
 * own section rather than mixed into the submitted fields.
 */
export interface ContactEmailContext {
  senderWaId: string
  /**
   * The sender's name as WE know it, independent of anything they typed: the
   * WhatsApp profile name on the Flow path, the member record on either.
   * Optional because a non-member with no profile name has neither.
   */
  contactName?: string
  timestamp: Date
  /**
   * The tenant's own form labels, so the first section reads back exactly as
   * the customer filled it in. A tenant who renamed 查詢主題 to something
   * domain-specific sees that word in the email too, not our default.
   */
  labels: ContactLabels
}

function formatHkTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} HKT`
}

/**
 * Part one: the form, as filled in, under the tenant's own labels — including
 * the form's title as the heading, so the email mirrors what the customer saw.
 */
function submittedFieldsSection(
  submission: ContactFormSubmission,
  labels: ContactLabels
): string {
  return [
    `${labels.title}:`,
    `${labels.nameLabel}: ${submission.clientName}`,
    `${labels.phoneLabel}: ${submission.clientWhatsapp}`,
    `${labels.topicLabel}: ${submission.topic}`,
  ].join('\n')
}

/**
 * Part two: who submitted it. Fixed labels, deliberately NOT the tenant's —
 * this section is our own record of the sender, not a read-back of their form,
 * and reusing the form's labels here would imply the two describe the same
 * person.
 */
function senderSection(context: ContactEmailContext): string {
  return [
    '提交查詢的會員:',
    `姓名: ${context.contactName ?? '(未提供)'}`,
    `WhatsApp 號碼: ${context.senderWaId}`,
    `提交時間: ${formatHkTimestamp(context.timestamp)}`,
  ].join('\n')
}

/**
 * Two parts, in this order: what was filled in, then who filled it in.
 *
 * The two need not describe the same person and no longer pretend to. An
 * earlier version marked any difference between the submitted number and the
 * sender's with ⚠️ 填寫號碼與傳送號碼不同, which framed the ordinary case —
 * a member enquiring on behalf of someone else — as a discrepancy to be
 * suspicious of. Separating the sections says the same thing without the
 * false alarm.
 */
export function buildContactEmail(
  submission: ContactFormSubmission,
  context: ContactEmailContext
): { subject: string; text: string } {
  return {
    subject: '新客戶查詢',
    text: [
      submittedFieldsSection(submission, context.labels),
      '',
      senderSection(context),
    ].join('\n'),
  }
}
