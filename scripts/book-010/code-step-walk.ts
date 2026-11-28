/**
 * BOOK-010 I-010: the PAP WhatsApp code step against a LOCAL Supabase stack
 * (real repositories, real PostgREST, migration 092's promote function), with
 * the WhatsApp senders replaced by recorders. Never point it at DEV or prod.
 *
 * Usage (repo root): NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local key> npx tsx scripts/book-010/code-step-walk.ts \
 *   <restaurantId> <phone> <code>
 * Prints one JSON line: the verify result, the replies sent and the templates sent.
 */
import { verifyAgentBooking } from '@/application/booking/verify-agent-booking'
import { agentBookingStore } from '@/infrastructure/supabase/repositories/agent-booking-repository'
import { bookingRoomStore } from '@/infrastructure/supabase/repositories/booking-room-repository'
import { bookingSettingsReader } from '@/infrastructure/supabase/repositories/booking-config-repository'
import type { BookingMessageInput, BookingMessageSender } from '@/domain/ports/booking'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(url)) {
  console.error('refusing: NEXT_PUBLIC_SUPABASE_URL must be the local stack (http://127.0.0.1:54321)')
  process.exit(2)
}

const [restaurantId, phone, code] = process.argv.slice(2)
const replies: string[] = []
const templates: BookingMessageInput[] = []
const sender: BookingMessageSender = {
  async send(input) {
    templates.push(input)
    return { delivered: true, via: 'template' }
  },
}
const link = async () => 'http://localhost:3030/b/<chat-token>'

async function main() {
  const result = await verifyAgentBooking(
    {
      store: agentBookingStore,
      members: { findMemberId: async () => null },
      settings: bookingSettingsReader,
      sender,
      sendText: async (_r, _p, text) => void replies.push(text),
      bookingLink: link,
      privacyUrl: 'https://ohmyclient.io/privacy-policy.html',
      now: () => new Date(),
      room: { reader: bookingRoomStore, bookingLink: link },
    },
    { restaurantId, phone, text: code, wamid: `wamid.i010.${Date.now()}` }
  )
  console.log(JSON.stringify({ result, replies, templates: templates.map((t) => t.kind) }))
}

void main()
