import QRCode from 'qrcode'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

const BUCKET_NAME = 'coupon-qr'

async function generateQrBuffer(couponCode: string): Promise<Buffer> {
  return QRCode.toBuffer(`REDEEM ${couponCode}`, {
    width: 300,
    margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  })
}

export async function uploadCouponQr(
  couponCode: string
): Promise<string> {
  const buffer = await generateQrBuffer(couponCode)
  const supabase = createServerSupabaseClient()
  const filePath = `${couponCode}.png`

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, buffer, {
      contentType: 'image/png',
      upsert: true,
    })

  if (error) throw new Error(`QR upload failed: ${error.message}`)

  const { data } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath)

  return data.publicUrl
}
