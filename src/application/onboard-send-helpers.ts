import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'

interface SendTarget {
  phoneNumberId: string
  phone: string
}

/**
 * Send the welcome message. If a per-language welcome image is attached to
 * the campaign, try the image-with-caption send first; on failure, fall
 * back to a plain text send so the member never loses the welcome copy.
 * Either way the QR coupon still ships as a separate second message (see
 * `sendCouponQrImage`).
 *
 * Best-effort: any WhatsApp outage must NEVER block the QR coupon second
 * message. Errors are warn-logged and swallowed at each step.
 */
export async function sendWelcomeBody(
  target: SendTarget,
  welcomeText: string,
  welcomeImageUrl: string | null
): Promise<void> {
  if (welcomeImageUrl) {
    try {
      await sendImageMessage(
        target.phoneNumberId,
        target.phone,
        welcomeImageUrl,
        welcomeText
      )
      return
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(
        `[Welcome] image send failed for phone ${target.phone} (pnid ${target.phoneNumberId}), falling back to text: ${reason}`
      )
    }
  }
  try {
    await sendTextMessage(target.phoneNumberId, target.phone, welcomeText)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(
      `[Welcome] text send failed for phone ${target.phone} (pnid ${target.phoneNumberId}): ${reason}`
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
