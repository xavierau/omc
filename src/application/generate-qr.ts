import QRCode from 'qrcode'

export interface GenerateQrParams {
  whatsappNumber: string
}

export interface GenerateQrResult {
  qrDataUrl: string
  deepLink: string
}

function buildDeepLink(whatsappNumber: string): string {
  const cleanNumber = whatsappNumber.replace('+', '')
  return `https://wa.me/${cleanNumber}?text=JOIN`
}

export async function generateQr(
  params: GenerateQrParams
): Promise<GenerateQrResult> {
  const { whatsappNumber } = params
  const deepLink = buildDeepLink(whatsappNumber)

  const qrDataUrl = await QRCode.toDataURL(deepLink, {
    width: 300,
    margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  })

  return { qrDataUrl, deepLink }
}
