/**
 * BOOK-001 W2: IntentClassifierPort over the Gemini Decisions API (REST).
 *
 * Contract (https://aistudio.google.com/docs/decisions-api, read 2026-11-12):
 * POST /v1beta/decisions, key in `x-goog-api-key` (never the URL), body
 * `{ model, input, questions }`; a `choice` question answers at
 * `answers.<key>` with `choice`, `probabilities` and `confidence` (= the
 * top option's probability). Option keys are sorted by the API, so none is
 * positional; each carries its own description.
 *
 * Only the message text, cut to 1,000 chars, leaves this process (R9, R12).
 * A hard 2 s AbortController timeout covers the response body too. Every
 * failure maps to a `ClassifyResult` reason and is never thrown; errors are
 * not logged here (the caller logs the reason with the message id, R8).
 */
import { truncateForClassifier } from '@/domain/services/booking-intent'
import {
  INTENT_LABELS,
  type ClassifierFailure,
  type ClassifyResult,
  type IntentClassifierPort,
  type IntentLabel,
} from '@/domain/ports/intent-classifier'

export const DECISIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions'
export const DECISIONS_MODEL = 'gemini-decision-1'
export const DECISIONS_TIMEOUT_MS = 2000
export const INTENT_QUESTION_KEY = 'intent'

const INSTRUCTIONS =
  'A diner sent this WhatsApp reply to a restaurant. It may be in Cantonese, written Chinese, ' +
  'English or a mix. Which option best describes what the diner wants?'

export const INTENT_CRITERIA: Record<IntentLabel, string> = {
  booking:
    'Wants to make or request a table reservation, or asks whether they can book (for example gives a ' +
    'date, time or number of people for a visit).',
  loyalty:
    'Asks about the loyalty programme: points, stamps, rewards, coupons, membership or their member card.',
  talk_to_staff:
    'Wants to talk to a person, or has a question, request or complaint for the restaurant staff that is ' +
    'not a reservation.',
  other: 'Anything else: greetings, thanks, emoji, chit-chat, or no clear request.',
}

export interface DecisionsRequestBody {
  model: string
  input: string
  questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<IntentLabel, string> }>
}

/** The whole request body: model, the truncated text and the question, nothing else (R9). */
export function buildDecisionsRequest(text: string): DecisionsRequestBody {
  return {
    model: DECISIONS_MODEL,
    input: truncateForClassifier(text),
    questions: {
      [INTENT_QUESTION_KEY]: { type: 'choice', instructions: INSTRUCTIONS, criteria: INTENT_CRITERIA },
    },
  }
}

const SAFETY_CODES = new Set(['safety', 'prohibited_content', 'blocklist', 'image_safety', 'content_blocked'])
const fail = (reason: ClassifierFailure): ClassifyResult => ({ ok: false, reason })
const isLabel = (v: unknown): v is IntentLabel => (INTENT_LABELS as readonly unknown[]).includes(v)
const isProbability = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1

/** Maps a 2xx JSON body to a label; anything off-contract is a parse failure. */
export function parseDecisionsResponse(body: unknown): ClassifyResult {
  const answers = (body as { answers?: Record<string, unknown> } | null)?.answers
  const answer = answers?.[INTENT_QUESTION_KEY] as { choice?: unknown; confidence?: unknown } | undefined
  if (!answer || !isLabel(answer.choice) || !isProbability(answer.confidence)) return fail('parse')
  return { ok: true, label: answer.choice, confidence: answer.confidence }
}

async function failureFor(res: Response): Promise<ClassifyResult> {
  if (res.status !== 400) return fail('http_error')
  const body = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null
  return SAFETY_CODES.has(String(body?.error?.code)) ? fail('safety') : fail('http_error')
}

async function readResult(res: Response): Promise<ClassifyResult> {
  if (!res.ok) return failureFor(res)
  const body = await res.json().catch(() => undefined)
  return body === undefined ? fail('parse') : parseDecisionsResponse(body)
}

export interface DecisionsClientOptions {
  fetchImpl?: typeof fetch
  getApiKey?: () => string | undefined
  timeoutMs?: number
}

export function createDecisionsClassifier(options: DecisionsClientOptions = {}): IntentClassifierPort {
  const fetchImpl = options.fetchImpl ?? fetch
  const getApiKey = options.getApiKey ?? (() => process.env.GEMINI_API_KEY)
  const timeoutMs = options.timeoutMs ?? DECISIONS_TIMEOUT_MS

  return {
    async classify(text: string): Promise<ClassifyResult> {
      const apiKey = getApiKey()
      if (!apiKey) return fail('no_key')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetchImpl(DECISIONS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(buildDecisionsRequest(text)),
          signal: controller.signal,
        })
        return await readResult(res)
      } catch {
        return fail(controller.signal.aborted ? 'timeout' : 'network')
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
