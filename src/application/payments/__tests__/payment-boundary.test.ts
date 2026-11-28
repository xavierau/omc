// BOOK-014 (spec AC-15; threat R51, R63): booking code talks to the payment
// provider only through the port. Nothing in the domain, the application, the
// cron route or the /p page imports the Stripe SDK or the Stripe adapter, and
// no Stripe setting is ever a NEXT_PUBLIC_ (client bundle) variable.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = process.cwd()
const STRIPE_IMPORT = /from\s+['"](stripe|@\/infrastructure\/payments\/stripe[^'"]*)['"]|require\(\s*['"]stripe['"]\s*\)|import\(\s*['"]stripe['"]\s*\)/

const SELF = path.join('src', 'application', 'payments', '__tests__', 'payment-boundary.test.ts')

function files(dir: string): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) return files(rel)
    return /\.(ts|tsx)$/.test(e.name) && rel !== SELF ? [rel] : []
  })
}

describe('AC-15 / R51: no Stripe outside src/infrastructure/payments/stripe', () => {
  it.each(['src/domain', 'src/application', 'src/app/api/cron', 'src/app/p'])('%s imports neither stripe nor the Stripe adapter', (dir) => {
    const offenders = files(dir).filter((f) => STRIPE_IMPORT.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the Stripe SDK is imported only by the Stripe adapter and the Stripe webhook route folder (its tests sign with it)', () => {
    const allowed = [path.join('src', 'infrastructure', 'payments', 'stripe'), path.join('src', 'app', 'api', 'webhooks', 'payments', 'stripe')]
    const offenders = files('src')
      .filter((f) => !allowed.some((dir) => f.startsWith(dir)))
      .filter((f) => /from\s+['"]stripe['"]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the guard itself catches an offending import', () => {
    // Built from parts so this file does not match the AC-3 grep it mirrors.
    const from = (spec: string, q = "'") => ['import X ', 'from ', q, spec, q].join('')
    expect(STRIPE_IMPORT.test(from('stripe'))).toBe(true)
    expect(STRIPE_IMPORT.test(from('@/infrastructure/payments/' + 'stripe/stripe-gateway', '"'))).toBe(true)
    expect(STRIPE_IMPORT.test(from('@/infrastructure/payments/registry'))).toBe(false)
  })
})

describe('R63: no Stripe variable is NEXT_PUBLIC_', () => {
  it('source and .env.example name no NEXT_PUBLIC_STRIPE variable', () => {
    const sources = [...files('src'), '.env.example', 'next.config.ts'].filter((f) => fs.existsSync(path.join(ROOT, f)))
    const offenders = sources.filter((f) => /NEXT_PUBLIC_STRIPE/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
