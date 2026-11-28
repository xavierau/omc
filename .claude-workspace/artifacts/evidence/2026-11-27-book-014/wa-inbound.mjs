// BOOK-014 W6b: a fake inbound WhatsApp text (Meta Cloud API shape, as Kapso forwards it) for the local walk.
// Signed with the walk-only KAPSO_WEBHOOK_SECRET from dev-run.sh. FAKE phone numbers only.
//   node wa-inbound.mjs <from E.164 digits> <text> [contact name]
import crypto from 'node:crypto'
const [from, text, name = 'Walk Diner'] = process.argv.slice(2)
const id = `wamid.WALKIN${Date.now()}${Math.floor(Math.random() * 1000)}`
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba-walk-fake', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '85200000001', phone_number_id: 'pn-walk-fake' },
    contacts: [{ profile: { name }, wa_id: from }],
    messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
  } }] }],
})
const sig = crypto.createHmac('sha256', 'walk-kapso-secret').update(body).digest('hex')
const res = await fetch('http://localhost:3080/api/webhooks/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-signature': sig, 'x-idempotency-key': id }, body })
console.log(res.status, await res.text(), id)
