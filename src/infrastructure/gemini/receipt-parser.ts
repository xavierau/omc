import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'

export type { ParsedReceipt }

const RECEIPT_PROMPT = `Parse this receipt and extract the following as JSON:
{
  "total": <total amount as number>,
  "items": [{"name": "<item name>", "price": <price as number>}],
  "confidence": <0.0-1.0 how confident you are in the total>,
  "currency": "<currency code, e.g. HKD>"
}

Important:
- The total should be the final amount paid (after tax/service charge)
- If you can't determine the total confidently, set confidence below 0.8
- If you can't read the receipt at all, set confidence to 0 and total to 0
- Return ONLY the JSON, no other text`

export async function parseReceiptImage(
  imageUrl: string
): Promise<ParsedReceipt> {
  const { base64, mimeType } = await fetchImageAsBase64(imageUrl)
  const text = await callGeminiVision(base64, mimeType)
  return extractReceiptJson(text)
}

async function fetchImageAsBase64(imageUrl: string) {
  const response = await fetch(imageUrl)
  const buffer = await response.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const mimeType = response.headers.get('content-type') ?? 'image/jpeg'
  return { base64, mimeType }
}

async function callGeminiVision(
  base64: string,
  mimeType: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' })

  const result = await model.generateContent([
    {
      inlineData: { data: base64, mimeType },
    },
    RECEIPT_PROMPT,
  ])

  return result.response.text()
}

function extractReceiptJson(text: string): ParsedReceipt {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')

    const parsed = JSON.parse(jsonMatch[0])
    return {
      total: Number(parsed.total) || 0,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      confidence: Number(parsed.confidence) || 0,
      currency: parsed.currency || 'HKD',
    }
  } catch {
    return { total: 0, items: [], confidence: 0, currency: 'HKD' }
  }
}
