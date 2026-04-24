import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'

interface SendTarget {
  phoneNumberId: string
  phone: string
}

/**
 * Send the welcome message. If a per-language welcome image is attached to
 * the campaign, send ONE image message with the welcome text as caption.
 * Otherwise, fall through to a text-only message. Either way the QR coupon
 * still ships as a separate second message (see `sendCouponQrImage`).
 *
 * Best-effort: a WhatsApp outage (image or text send failure) must NEVER
 * block the QR coupon second message, which is the point of the whole
 * flow. Warn-log with context and swallow.
 */
export async function sendWelcomeBody(
  target: SendTarget,
  welcomeText: string,
  welcomeImageUrl: string | null
): Promise<void> {
  try {
    if (welcomeImageUrl) {
      await sendImageMessage(
        target.phoneNumberId,
        target.phone,
        welcomeImageUrl,
        welcomeText
      )
      return
    }
    await sendTextMessage(target.phoneNumberId, target.phone, welcomeText)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(
      `[Welcome] sendWelcomeBody failed for phone ${target.phone} (pnid ${target.phoneNumberId}, hasImage=${welcomeImageUrl !== null}): ${reason}`
    )
  }
}

/**
 * Best-effort QR-coupon image send. Logs and swallows errors so an upload
 * flake never blocks the onboarding flow — the member already has the
 * welcome body.
 */
export async function sendCouponQrImage(
  target: SendTarget,
  couponCode: string,
  caption: string
): Promise<void> {
  try {
    const qrUrl = await uploadCouponQr(couponCode)
    await sendImageMessage(target.phoneNumberId, target.phone, qrUrl, caption)
  } catch (err) {
    console.warn('[QR] Failed to send coupon QR:', (err as Error).message)
  }
}
