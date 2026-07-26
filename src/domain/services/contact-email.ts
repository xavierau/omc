/**
 * REPLY-005: pure formatter for the "contact us" notification email.
 * Zero infra imports — the webhook handler (Stream D) builds context and
 * calls `EmailPort.send` with this output.
 */

export interface ContactFormSubmission {
  clientName: string
  clientWhatsapp: string
  topic: string
}

export interface ContactEmailContext {
  senderWaId: string
  contactName?: string
  restaurantName: string
  restaurantWhatsappNumber: string
  timestamp: Date
  messageId: string
}

const MISMATCH_MARKER = '⚠️ 填寫號碼與傳送號碼不同'

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '')
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

function submittedFieldsSection(submission: ContactFormSubmission, marker: string): string {
  return [
    '客戶查詢詳情:',
    `姓名: ${submission.clientName}`,
    `客戶填寫的 WhatsApp 號碼: ${submission.clientWhatsapp}${marker}`,
    `查詢主題: ${submission.topic}`,
  ].join('\n')
}

function whatsappContextSection(context: ContactEmailContext, marker: string): string {
  return [
    'WhatsApp 對話資訊:',
    `傳送訊息的 WhatsApp 號碼: ${context.senderWaId}${marker}`,
    `WhatsApp 個人資料名稱: ${context.contactName ?? '(未提供)'}`,
    `餐廳: ${context.restaurantName} (${context.restaurantWhatsappNumber})`,
    `提交時間: ${formatHkTimestamp(context.timestamp)}`,
    `WhatsApp 訊息 ID: ${context.messageId}`,
  ].join('\n')
}

export function buildContactEmail(
  submission: ContactFormSubmission,
  context: ContactEmailContext
): { subject: string; text: string } {
  const isMismatch =
    normalizeDigits(submission.clientWhatsapp) !== normalizeDigits(context.senderWaId)
  const marker = isMismatch ? ` ${MISMATCH_MARKER}` : ''

  return {
    subject: `[OhMyClient] 新客戶查詢 — ${context.restaurantName}`,
    text: [
      submittedFieldsSection(submission, marker),
      '',
      whatsappContextSection(context, marker),
    ].join('\n'),
  }
}
