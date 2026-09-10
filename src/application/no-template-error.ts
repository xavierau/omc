// Extracted from execute-campaign.ts (review round 2, #102 item 8) so
// consumers that only need the error CLASS — e.g. campaign-queue.ts's
// failure_reason classification, or a test file — don't have to pull in
// execute-campaign.ts's full transitive dependency graph (which reaches
// the event-dispatch queue via emitEvent, and would otherwise force a real
// `vi.importActual` of that whole tree just to reference this class).

export class NoTemplateError extends Error {
  constructor(campaignId: string) {
    super(`Campaign ${campaignId} has no template in any language`)
    this.name = 'NoTemplateError'
  }
}
