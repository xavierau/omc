import { readFileSync } from 'fs'
import { resolve } from 'path'

const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const val = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* .env.local is optional */ }

import { createTenant } from '@/application/create-tenant'

async function main() {
  const result = await createTenant({
    name: 'OMC Kitchen',
    slug: 'omc-kitchen',
    whatsappNumber: '+85246737267',
    kapsoPhoneNumberId: '1096318023560916',
    metaBusinessAccountId: '1310813730949180',
    adminEmail: 'admin@omckitchen.com',
    adminPassword: 'password',
  })
  console.log(JSON.stringify(result, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
