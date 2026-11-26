// BOOK-013 local walk only: a Node preload (NODE_OPTIONS=--require) that
// answers every call to api.kapso.ai with a fake success and appends the
// request (method, path, JSON body) to KAPSO_FAKE_LOG. No message leaves the
// machine; every phone number in the walk is fake. Never used by the app.
const fs = require('fs')
const LOG = process.env.KAPSO_FAKE_LOG || 'kapso-fake.jsonl'
const real = globalThis.fetch
let n = 0

globalThis.fetch = async function fakeKapsoFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (!url.includes('api.kapso.ai')) return real(input, init)
  let body = null
  try {
    body = init.body ? JSON.parse(String(init.body)) : null
  } catch {
    body = String(init.body).slice(0, 2000)
  }
  const at = new Date().toISOString()
  fs.appendFileSync(LOG, JSON.stringify({ at, method: init.method || 'GET', path: new URL(url).pathname, body }) + '\n')
  const id = `wamid.FAKE${String(++n).padStart(4, '0')}`
  return new Response(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ input: 'fake', wa_id: 'fake' }], messages: [{ id }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
