// TPL-012 AC-8: probe whether the Kapso proxy forwards POST /<template_id> to Graph.
// Only a clearly bogus numeric id is ever used. Never a real template id.
const key = process.env.KAPSO_API_KEY
if (!key) { console.log('no KAPSO_API_KEY'); process.exit(1) }
const BOGUS = '999999999999999'
const base = 'https://api.kapso.ai/meta/whatsapp/v23.0'
const red = (s) => (s ? String(s).replace(/(\d{4})\d+(\d{3})/g, '$1…$2') : s)

async function configs() {
  const r = await fetch('https://app.kapso.ai/api/v1/whatsapp_configs?page=1&per_page=5', { headers: { 'X-API-Key': key } })
  const j = await r.json()
  const c = (j.data ?? []).find((x) => x.phone_number_id && x.business_account_id)
  return c
}

async function probe(label, query) {
  const url = `${base}/${BOGUS}${query ? '?' + new URLSearchParams(query) : ''}`
  const r = await fetch(url, { method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ components: [] }) })
  const text = await r.text()
  console.log(`--- ${label}`)
  console.log(`POST /v23.0/${BOGUS}${query ? '?' + Object.keys(query).map((k) => k + '=<redacted>').join('&') : ''}`)
  console.log(`status ${r.status} content-type ${r.headers.get('content-type')}`)
  console.log(`body ${red(text.slice(0, 600))}`)
}

console.log(`probe at ${new Date().toISOString()}`)
const c = await configs()
console.log(`config found: ${c ? 'yes' : 'no'}`)
await probe('A bare', null)
if (c) {
  await probe('B business_account_id', { business_account_id: c.business_account_id })
  await probe('C phone_number_id', { phone_number_id: c.phone_number_id })
}
