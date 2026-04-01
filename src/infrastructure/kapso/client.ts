import { WhatsAppClient } from '@kapso/whatsapp-cloud-api'

const KAPSO_BASE_URL = 'https://api.kapso.ai/meta/whatsapp'

let cachedClient: WhatsAppClient | null = null

function getClient(): WhatsAppClient | null {
  if (cachedClient) return cachedClient

  const kapsoApiKey = process.env.KAPSO_API_KEY
  if (!kapsoApiKey) return null

  cachedClient = new WhatsAppClient({
    kapsoApiKey,
    baseUrl: KAPSO_BASE_URL,
  })
  return cachedClient
}

export async function sendTextMessage(
  phoneNumberId: string,
  to: string,
  text: string
): Promise<void> {
  const client = getClient()
  if (!client) {
    console.warn('[Kapso] No API key — message not sent:', { to, text })
    return
  }

  if (!phoneNumberId) {
    console.warn('[Kapso] No phoneNumberId — message not sent:', { to, text })
    return
  }

  try {
    await client.messages.sendText({ phoneNumberId, to, body: text })
  } catch (err) {
    console.warn('[Kapso] Error sending message:', (err as Error).message)
  }
}

export async function sendImageMessage(
  phoneNumberId: string,
  to: string,
  imageUrl: string,
  caption?: string
): Promise<void> {
  const client = getClient()
  if (!client) {
    console.warn('[Kapso] No API key — image not sent:', { to, imageUrl })
    return
  }

  if (!phoneNumberId) {
    console.warn('[Kapso] No phoneNumberId — image not sent:', { to, imageUrl })
    return
  }

  try {
    await client.messages.sendImage({
      phoneNumberId,
      to,
      image: { link: imageUrl, caption },
    })
  } catch (err) {
    console.warn('[Kapso] Error sending image:', (err as Error).message)
  }
}

export async function sendInteractiveButtons(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  footerText?: string
): Promise<void> {
  const client = getClient()
  if (!client) {
    console.warn('[Kapso] No API key — buttons not sent:', { to, bodyText })
    return
  }

  if (!phoneNumberId) {
    console.warn('[Kapso] No phoneNumberId — buttons not sent:', { to, bodyText })
    return
  }

  try {
    await client.messages.sendInteractiveButtons({
      phoneNumberId,
      to,
      bodyText,
      buttons,
      footerText,
    })
  } catch (err) {
    console.warn('[Kapso] Error sending buttons:', (err as Error).message)
  }
}
