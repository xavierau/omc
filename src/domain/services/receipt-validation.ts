import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'

interface TamperResult {
  isSuspicious: boolean
  reasons: string[]
}

const DIVERGENCE_THRESHOLD = 0.2

export function assessTamperRisk(parsed: ParsedReceipt): TamperResult {
  const reasons: string[] = []

  addSumDivergenceReason(parsed, reasons)
  addAiTamperReasons(parsed, reasons)

  return { isSuspicious: reasons.length > 0, reasons }
}

export function isMerchantMatch(
  receiptMerchantName: string | null,
  knownNames: string[]
): boolean {
  if (!receiptMerchantName?.trim()) return true
  const normalized = normalize(receiptMerchantName)
  return knownNames.some((known) => matchesAnyTier(normalized, receiptMerchantName, known))
}

function addSumDivergenceReason(
  parsed: ParsedReceipt,
  reasons: string[]
): void {
  if (parsed.items.length === 0) return
  const sum = parsed.items.reduce((acc, i) => acc + i.price, 0)
  if (parsed.total === 0) return
  const divergence = Math.abs(sum - parsed.total) / parsed.total
  if (divergence > DIVERGENCE_THRESHOLD) {
    reasons.push(`Items sum ($${sum}) diverges from total ($${parsed.total}) by ${(divergence * 100).toFixed(0)}%`)
  }
}

function addAiTamperReasons(
  parsed: ParsedReceipt,
  reasons: string[]
): void {
  if (!parsed.tamperAssessment?.isSuspicious) return
  reasons.push(...parsed.tamperAssessment.reasons)
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s]/gu, '')
}

function matchesAnyTier(
  normalizedReceipt: string,
  rawReceipt: string,
  knownName: string
): boolean {
  const normalizedKnown = normalize(knownName)
  if (normalizedReceipt === normalizedKnown) return true
  if (normalizedReceipt.includes(normalizedKnown)) return true
  if (normalizedKnown.includes(normalizedReceipt)) return true
  return tokenJaccardSimilarity(rawReceipt, knownName) >= 0.3
}

function tokenJaccardSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a)
  const tokensB = tokenize(b)
  if (tokensA.size === 0 && tokensB.size === 0) return 1
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  const intersection = [...tokensA].filter((t) => tokensB.has(t))
  const union = new Set([...tokensA, ...tokensB])
  return intersection.length / union.size
}

function tokenize(s: string): Set<string> {
  const cleaned = normalize(s)
  if (isCjk(cleaned)) return new Set(cleaned.replace(/\s/g, '').split(''))
  return new Set(cleaned.split(/\s+/).filter(Boolean))
}

function isCjk(s: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s)
}
