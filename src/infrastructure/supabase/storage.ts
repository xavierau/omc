import QRCode from 'qrcode'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

const BUCKET_NAME = 'coupon-qr'

async function generateQrBuffer(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    width: 300,
    margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  })
}

// Render `payload` into a QR PNG and upload it to the coupon-qr bucket under
// `fileName`. Shared core for both the coupon (`REDEEM <code>`) and loyalty
// (`LOYALTY:<token>`) QR encodings so the upload path lives in one place.
async function uploadQr(payload: string, fileName: string): Promise<string> {
  const buffer = await generateQrBuffer(payload)
  const supabase = createServerSupabaseClient()
  const filePath = `${fileName}.png`

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, buffer, {
      contentType: 'image/png',
      upsert: true,
    })

  if (error) throw new Error(`QR upload failed: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath)
  return data.publicUrl
}

export async function uploadCouponQr(couponCode: string): Promise<string> {
  return uploadQr(`REDEEM ${couponCode}`, couponCode)
}

/**
 * Render the member's persistent `LOYALTY:<token>` QR for the 「我的會員碼」 keyword
 * (plan §8). The scan-resolver's loyalty strategy strips the `LOYALTY:` prefix —
 * the `:` is the disambiguator from a `REDEEM `-prefixed coupon QR.
 */
export async function uploadLoyaltyQr(token: string): Promise<string> {
  return uploadQr(`LOYALTY:${token}`, `loyalty-${token}`)
}
