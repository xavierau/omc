/**
 * BOOK-001 W2-09: one live call per synthetic message through the real
 * adapter, printing the HTTP status, the response's key shape and the
 * mapped result, so the request/response mapping is checked against the
 * real API. Never prints the API key.
 *
 *   npx tsx scripts/eval/decisions-smoke.ts
 */
import '../load-env'
import { createDecisionsClassifier } from '@/infrastructure/gemini/decisions-client'

const SYNTHETIC = ['想訂星期五7點4位', 'how many points do I have']

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : []
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
  }
  return typeof value
}

const tracingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  const body = await res.clone().json().catch(() => '<non-JSON body>')
  console.log(`  HTTP ${res.status}`)
  console.log(`  shape: ${JSON.stringify(shape(body))}`)
  console.log(`  answers: ${JSON.stringify((body as { answers?: unknown })?.answers ?? (body as { error?: unknown })?.error)}`)
  return res
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set')
  const classifier = createDecisionsClassifier({ fetchImpl: tracingFetch })
  for (const text of SYNTHETIC) {
    console.log(`synthetic: ${text}`)
    const started = Date.now()
    const result = await classifier.classify(text)
    console.log(`  mapped: ${JSON.stringify(result)}  (${Date.now() - started} ms)`)
  }
}

main().catch((err: Error) => {
  console.error(`smoke failed: ${err.message}`)
  process.exit(1)
})
