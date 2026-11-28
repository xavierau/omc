// BOOK-013 local walk only: a Node preload (NODE_OPTIONS=--require) that
// answers every call to api.kapso.ai / app.kapso.ai with a fake success
// (message ids, WABA lookup, media handle, template create) and appends the
// request (method, path, JSON body) to KAPSO_FAKE_LOG. No message leaves the
// machine; every phone number in the walk is fake. Never used by the app.
const fs = require('fs')
const LOG = process.env.KAPSO_FAKE_LOG || 'kapso-fake.jsonl'
const real = globalThis.fetch
let n = 0

globalThis.fetch = async function fakeKapsoFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (!/^https:\/\/(api|app)\.kapso\.ai\//.test(url)) return real(input, init)
  let body = null
  try {
    body = init.body ? JSON.parse(String(init.body)) : null
  } catch {
    body = String(init.body).slice(0, 2000)
  }
  const at = new Date().toISOString()
  fs.appendFileSync(LOG, JSON.stringify({ at, method: init.method || 'GET', path: new URL(url).pathname, body }) + '\n')
  const p = new URL(url).pathname
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  n += 1
  if (p.endsWith('/whatsapp_configs')) return json({ data: [{ phone_number_id: 'pn-walk-fake', business_account_id: 'waba-walk-fake' }], meta: { page: 1, total_pages: 1 } })
  if (p.endsWith('/platform/v1/whatsapp/media')) return json({ data: { target: { handle: '4::ZmFrZQ==' } } })
  if (p.endsWith('/message_templates') && (init.method || 'GET') === 'POST') return json({ id: `meta-tpl-fake-${n}`, status: 'PENDING', category: 'UTILITY' })
  if (p.endsWith('/message_templates')) return json({ data: [] })
  return json({ messaging_product: 'whatsapp', contacts: [{ input: 'fake', wa_id: 'fake' }], messages: [{ id: `wamid.FAKE${String(n).padStart(4, '0')}` }] })
}
