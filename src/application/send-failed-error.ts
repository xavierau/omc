// #127 red-team fix: distinguishes "the BSP rejected this send" from every
// other rejection in the per-member pipeline (post-send bookkeeping like
// incrementCampaignSent/emitEvent, or a pre-send crash). Only this class may
// count toward the all-sends-failed terminal status — a delivered run whose
// bookkeeping broke must never be marked "all sends failed", because reviving
// it would re-send to every member.
export class SendFailedError extends Error {
  constructor(mode: string, title: string) {
    super(`${mode} send failed: ${title}`)
    this.name = 'SendFailedError'
  }
}
