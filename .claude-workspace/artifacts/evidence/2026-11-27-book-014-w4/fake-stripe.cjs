// BOOK-014 W4 local walk only: a Node preload (NODE_OPTIONS=--require) that answers every Stripe SDK
// request to api.stripe.com with a fake success, so no request ever reaches Stripe and the process
// holds only a dummy key. Checkout sessions get a checkout.stripe.com URL (fake id); refunds succeed,
// or come back status "failed" while the file $FAKE_STRIPE_FAIL_FLAG exists. Every request
// (method, path, form body keys) is appended to $FAKE_STRIPE_LOG. Never used by the app.
const https = require('https')
const fs = require('fs')
const { EventEmitter } = require('events')
const { PassThrough } = require('stream')
const LOG = process.env.FAKE_STRIPE_LOG || 'stripe-fake.jsonl'
const FAIL = process.env.FAKE_STRIPE_FAIL_FLAG || '/nonexistent'
const real = https.request
let n = 0

function answer(method, path, body) {
  n += 1
  const now = Math.floor(Date.now() / 1000)
  if (method === 'POST' && path === '/v1/checkout/sessions') {
    const id = `cs_test_walkfake_${Date.now()}_${n}`
    return { id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, expires_at: Number(body.get('expires_at')) || now + 86000, status: 'open' }
  }
  if (method === 'POST' && /^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(path)) return { id: path.split('/')[4], object: 'checkout.session', status: 'expired' }
  if (method === 'POST' && path === '/v1/refunds') {
    return { id: `re_walkfake_${n}`, object: 'refund', status: fs.existsSync(FAIL) ? 'failed' : 'succeeded', amount: Number(body.get('amount')) }
  }
  return { id: `obj_walkfake_${n}`, object: 'unknown' }
}

https.request = function fakeStripeRequest(options, cb) {
  const host = typeof options === 'string' ? new URL(options).hostname : options.host || options.hostname
  if (host !== 'api.stripe.com') return real.apply(this, arguments)
  const req = new EventEmitter()
  const chunks = []
  req.write = (c) => { chunks.push(Buffer.from(c)); return true }
  req.setTimeout = () => req
  req.setHeader = () => {}
  req.destroy = () => {}
  req.end = (c) => {
    if (c) chunks.push(Buffer.from(c))
    const method = options.method || 'GET'
    const path = options.path.split('?')[0]
    const body = new URLSearchParams(Buffer.concat(chunks).toString())
    const json = answer(method, path, body)
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), method, path, account: options.headers?.['Stripe-Account'] ?? null, keys: [...new Set(body.keys())], status: json.status ?? null }) + '\n')
    const res = new PassThrough()
    res.statusCode = 200
    res.headers = { 'content-type': 'application/json', 'request-id': `req_walkfake_${n}` }
    setImmediate(() => {
      req.emit('response', res)
      cb?.(res)
      res.end(JSON.stringify(json))
    })
  }
  setImmediate(() => req.emit('socket', { connecting: false, once() {}, on() {}, setTimeout() {} }))
  return req
}
try { require('module').syncBuiltinESMExports() } catch {}
