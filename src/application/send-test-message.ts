import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'

const TEST_MESSAGE =
  'Hello from OhMyClient! Your WhatsApp number is connected.'

const PHONE_REGEX = /^\+\d+$/

interface SendResult {
  sent: boolean
  error?: string
}

export async function sendTestMessage(
  kapsoPhoneNumberId: string,
  toNumber: string
): Promise<SendResult> {
  if (!PHONE_REGEX.test(toNumber)) {
    return {
      sent: false,
      error: 'toNumber must start with + followed by digits',
    }
  }

  try {
    await sendTextMessage(kapsoPhoneNumberId, toNumber, TEST_MESSAGE)
    return { sent: true }
  } catch (err) {
    console.error('sendTestMessage error:', err)
    return { sent: false, error: 'Failed to send test message' }
  }
}
