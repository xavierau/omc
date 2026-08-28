import type { LayoutTemplate, LayoutVerificationResult } from '@/domain/interfaces/layout-verification'

export function isLayoutServiceEnabled(): boolean {
  return process.env.LAYOUT_SERVICE_ENABLED !== 'false'
}

function getConfig() {
  return {
    apiUrl: process.env.LAYOUT_SERVICE_URL ?? 'http://localhost:8000',
    apiKey: process.env.LAYOUT_SERVICE_API_KEY ?? '',
  }
}

function buildHeaders(): Record<string, string> {
  const { apiKey } = getConfig()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  return headers
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const { apiUrl } = getConfig()
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown')
    throw new Error(`Layout service ${path} failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<T>
}

export async function preprocessImage(imageUrl: string): Promise<{
  cleanedImageBase64: string
  method: string
  cornersDetected: boolean
}> {
  interface RawResponse {
    cleaned_image_base64: string
    method: string
    corners_detected: boolean
  }
  const data = await post<RawResponse>('/preprocess', { image_url: imageUrl })
  return {
    cleanedImageBase64: data.cleaned_image_base64,
    method: data.method,
    cornersDetected: data.corners_detected,
  }
}

export async function buildLayoutTemplate(
  imageUrls: string[],
  restaurantId: string
): Promise<LayoutTemplate> {
  return post<LayoutTemplate>('/templates/build', {
    image_urls: imageUrls,
    restaurant_id: restaurantId,
  })
}

export async function verifyReceiptLayout(
  imageUrl: string,
  template: LayoutTemplate,
  threshold?: number
): Promise<LayoutVerificationResult> {
  return post<LayoutVerificationResult>('/verify', {
    image_url: imageUrl,
    template,
    threshold,
  })
}

export async function checkHealth(): Promise<boolean> {
  if (!isLayoutServiceEnabled()) return false
  try {
    const { apiUrl } = getConfig()
    const res = await fetch(`${apiUrl}/health`, { headers: buildHeaders() })
    return res.ok
  } catch {
    return false
  }
}
