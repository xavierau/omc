import type { ParsedReceipt, TamperAssessment } from '@/domain/interfaces/parsed-receipt'

const FALLBACK: ParsedReceipt = {
  total: 0,
  items: [],
  confidence: 0,
  currency: 'HKD',
  receiptNumber: null,
  merchantName: null,
  tamperAssessment: null,
}

export function mapFlowForgeResultToReceipt(
  result: unknown
): ParsedReceipt {
  try {
    const extracted = extractData(result)
    if (!extracted) return FALLBACK

    const total = Number(extracted.total) || 0
    if (total <= 0) return FALLBACK

    return {
      total,
      items: parseItems(extracted.items),
      confidence: 0.95,
      currency: String(extracted.currency || 'HKD'),
      receiptNumber: parseString(extracted.receipt_number),
      merchantName: parseString(extracted.merchant_name),
      tamperAssessment: parseTamperAssessment(extracted.tamper_assessment),
    }
  } catch {
    return FALLBACK
  }
}

function extractData(
  result: unknown
): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null
  const data = (result as Record<string, unknown>).data
  if (!data || typeof data !== 'object') return null
  const extracted = (data as Record<string, unknown>).extracted_data
  if (extracted && typeof extracted === 'object') {
    return extracted as Record<string, unknown>
  }
  return data as Record<string, unknown>
}

function parseItems(
  raw: unknown
): { name: string; price: number }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name ?? ''),
      price: Number(item.price) || 0,
    }))
}

function parseString(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s.length > 0 ? s : null
}

function parseTamperAssessment(
  raw: unknown
): TamperAssessment | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.is_suspicious !== 'boolean') return null
  return {
    isSuspicious: obj.is_suspicious,
    reasons: Array.isArray(obj.reasons)
      ? obj.reasons.map(String)
      : [],
  }
}
