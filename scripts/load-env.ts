import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local into process.env BEFORE imports that read env at module top-level
// (e.g. @/application/create-tenant → supabase client).
const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    if (!process.env[key]) process.env[key] = trimmed.slice(eqIdx + 1)
  }
} catch { /* .env.local is optional */ }
