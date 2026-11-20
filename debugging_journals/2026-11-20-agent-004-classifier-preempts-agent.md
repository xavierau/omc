# AGENT-004: the BOOK-001 classifier pre-empted the reply agent mid-conversation

Date: 2026-11-20. Branch `fix/agent-004-classifier-skip-when-agent-books`, PR #204 into develop.

## Problem
Prod incident (omc), 2026-11-19 15:34Z. The reply agent (mode auto, with booking tools enabled)
asked a diner which existing booking they wanted to change. The diner answered with a date and a
party size. That answer scored as a booking intent (0.89) in BOOK-001's single-message
classifier, so the diner got the NEW-booking CTA form. The text never reached the agent: no
`agent_messages` row was written. The result was a duplicate booking instead of a change.

## Root cause
`dispatchConfirmation` (src/app/api/webhooks/whatsapp/handlers.ts) runs the BOOK-001
classifier (`maybeReplyToBookingIntent`) before the reply agent (`maybeQueueAgentReply`) for
every unmatched text. The order was set by BOOK-001 (released before AGENT-003), when the agent
could not book. AGENT-003 gave the agent booking tools, but the dispatch order stayed the same.
The classifier sees one message with no thread history (by design, threat R9) and can only offer
a new booking. So any booking-sounding reply inside an agent conversation was taken away from
the agent.

## Fix
- `agentOffersBookingTools(config, bookingMode)` in `src/application/agent/agent-tools.ts`
  returns true when agent mode is auto AND the worker's own `offeredTools` (enabledTools filtered
  by the booking mode) contains at least one booking tool. Like the worker, it offers no tool
  when `maxToolCalls` is 0.
- `agentOwnsBookingText` in `src/application/agent/agent-owns-booking-text.ts` reads both
  configs. Any failure returns false, which is today's order (fall-open, BOOK-001 R12).
- The webhook `agentOwnsBookings` runs for text only. `dispatchConfirmation` skips the
  classifier when it returns true, and the text goes on to the agent.
- When the classifier is skipped, no classification row is written and no token is minted. The
  exact BOOK keyword route is unchanged.

## Prevention
- The test file `agent-routing.test.ts` now has an AGENT-004 matrix that pins the dispatch
  order for every combination: agent mode × enabled tools × booking mode, plus config-read
  failures and the BOOK keyword.
- Lesson: when a later feature takes over a capability that an earlier router already handles
  (here, booking), re-check the dispatch order in the same change. A router that sees a single
  message must give way to the component that holds the conversation.
- The predicate reuses the worker's tool rule (`offeredTools`) instead of a copy, so the webhook
  and the worker cannot disagree about whether the agent can book.
