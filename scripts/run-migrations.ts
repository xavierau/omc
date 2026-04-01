import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function runSQL(sql: string, name: string) {
  console.log(`Running ${name}...`)
  const resp = await fetch(`${url}/sql`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (resp.ok) {
    console.log(`  ${name} succeeded`)
  } else {
    const text = await resp.text()
    console.log(`  ${name} endpoint returned ${resp.status}: ${text.substring(0, 300)}`)
    // Fallback: try individual statements
    console.log(`  Trying statement-by-statement...`)
    const supabase = createClient(url, key)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    for (const stmt of statements) {
      const { error } = await supabase.rpc('query', { sql: stmt })
      if (error) {
        // Last resort: just log and continue
        console.log(`    Statement failed: ${stmt.substring(0, 60)}... (${error.message})`)
      }
    }
  }
}

async function main() {
  const sql1 = readFileSync('supabase/migrations/001_create_tables.sql', 'utf8')
  const sql2 = readFileSync('supabase/migrations/002_create_triggers.sql', 'utf8')

  await runSQL(sql1, 'migration 001_create_tables')
  await runSQL(sql2, 'migration 002_create_triggers')

  console.log('\nDone. Now run: npm run seed:demo')
}

main().catch(err => { console.error(err); process.exit(1) })
