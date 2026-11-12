import type { EmailSendResult } from '@/domain/value-objects/email-send-result'

export interface EmailPort {
  send(message: {
    to: string
    subject: string
    text: string
    html?: string
  }): Promise<EmailSendResult>
}
