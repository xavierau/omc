/**
 * WAQ_TRACK_MESSAGES flipped from opt-IN to opt-OUT (#131). The old
 * `=== '1'` gate needed a Forge env change to switch on — prod never made
 * that change in 4 months, so `whatsapp_messages` stayed empty: status
 * webhooks had no row to update, the WAQ-007 per-user cooldown never
 * enforced, and an async Meta rejection could never retract a campaign's
 * sent counter (#131: 4 phantom chargeable sends billed on 2 rejected
 * Kushiro campaigns). "Flip it on in prod later" is the exact forgettable-
 * ops failure class this repo has already paid for twice.
 *
 * Set to '0' to disable tracking (e.g. an emergency kill switch) — any
 * other value, including unset, keeps tracking on.
 */
export function isMessageTrackingEnabled(): boolean {
  return process.env.WAQ_TRACK_MESSAGES !== '0'
}
