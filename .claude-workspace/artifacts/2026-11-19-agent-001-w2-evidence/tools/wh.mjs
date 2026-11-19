// Signed inbound text webhook to the local app. Usage: node wh.mjs <wamid> <text> [from]
import crypto from 'node:crypto'
const [wamid, text, from = '85290000001'] = process.argv.slice(2)
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA-W2', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: 'pn-w2-local', display_phone_number: '85230000000' },
    contacts: [{ profile: { name: 'W2 Diner' }, wa_id: from }],
    messages: [{ id: wamid, from, type: 'text', text: { body: text }, timestamp: String(Math.floor(Date.now() / 1000)) }],
  } }] }],
})
const sig = crypto.createHmac('sha256', process.env.KAPSO_WEBHOOK_SECRET).update(body).digest('hex')
const res = await fetch(`${process.env.APP}/api/webhooks/whatsapp`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-signature': sig, 'x-idempotency-key': wamid }, body,
})
console.log(new Date().toISOString(), wamid, res.status, await res.text())
