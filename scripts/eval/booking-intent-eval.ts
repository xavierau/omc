/**
 * BOOK-001 W2 (spec "Classifier eval before go-live", R20).
 *
 *   npx tsx scripts/eval/booking-intent-eval.ts <labelled.csv>
 *
 * Reads a `text,label` CSV, classifies each text with the real Decisions
 * adapter (GEMINI_API_KEY from the env or .env.local) and prints
 * precision/recall/F1 for `booking` at thresholds 0.5..0.9 plus a confusion
 * table. It prints counts only and writes nothing: the texts never leave
 * this process except in the classifier call itself.
 *
 * Real diner replies go under scripts/eval/data/ (gitignored), with phone
 * numbers and names removed first, and are deleted after the eval (R20).
 */
import '../load-env'
import { readFileSync } from 'node:fs'
import { createDecisionsClassifier } from '@/infrastructure/gemini/decisions-client'
import { formatReport, parseLabelledCsv, type Prediction } from './booking-intent-metrics'

async function main(): Promise<number> {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: npx tsx scripts/eval/booking-intent-eval.ts <labelled.csv>')
    return 2
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set')
    return 2
  }
  const rows = parseLabelledCsv(readFileSync(path, 'utf8'))
  const classifier = createDecisionsClassifier()
  const predictions: Prediction[] = []
  for (const row of rows) {
    predictions.push({ gold: row.label, result: await classifier.classify(row.text) })
  }
  console.log(formatReport(predictions))
  return 0
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`eval failed: ${err.message}`)
    process.exit(1)
  }
)
