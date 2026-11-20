/**
 * BOOK-001 W2: classifies a diner's free-text reply into one intent.
 *
 * A Result, not `T | null`: the caller records WHY a call produced no label
 * (timeout vs safety block vs bad key), and every failure falls open to
 * today's reply (threat model R12). The adapter receives the message text
 * only, never the phone, name or member (R9).
 */
export const INTENT_LABELS = ['booking', 'loyalty', 'talk_to_staff', 'other'] as const
export type IntentLabel = (typeof INTENT_LABELS)[number]

export type ClassifierFailure = 'no_key' | 'timeout' | 'safety' | 'http_error' | 'network' | 'parse'

export type ClassifyResult =
  | { ok: true; label: IntentLabel; confidence: number }
  | { ok: false; reason: ClassifierFailure }

export interface IntentClassifierPort {
  classify(text: string): Promise<ClassifyResult>
}
