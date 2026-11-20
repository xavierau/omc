// I-task only (not in repo): intercept every Kapso API call at the provider
// (global fetch), append it to KAPSO_CAPTURE_FILE and answer like a send
// succeeded. Nothing leaves the machine for api.kapso.ai.
const fs = require('fs')
const file = process.env.KAPSO_CAPTURE_FILE
const realFetch = globalThis.fetch
let n = 0
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url && url.startsWith('https://api.kapso.ai/')) {
    n += 1
    const id = `wamid.capture.${process.pid}.${n}`
    let body = init && init.body
    try { body = JSON.parse(body) } catch {}
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, method: (init && init.method) || 'GET', url, body, id }) + '\n')
    return new Response(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ input: 'x', wa_id: 'x' }], messages: [{ id }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  return realFetch.apply(this, arguments)
}
