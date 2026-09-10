import QRCode from 'qrcode'

export interface GenerateWebQrResult {
  qrDataUrl: string
  joinUrl: string
}

function buildJoinUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${base}/join/${slug}`
}

export async function generateWebQr(
  slug: string
): Promise<GenerateWebQrResult> {
  const joinUrl = buildJoinUrl(slug)

  const qrDataUrl = await QRCode.toDataURL(joinUrl, {
    width: 300,
    margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  })

  return { qrDataUrl, joinUrl }
}
