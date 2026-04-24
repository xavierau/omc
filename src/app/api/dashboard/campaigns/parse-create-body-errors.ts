/**
 * Shared error class for campaign body parsing. Extracted into its own
 * module so helpers like `parse-image-url.ts` can throw it without
 * importing the full `parse-create-body.ts` (keeps imports acyclic and
 * the body-parser file under the 150-line cap).
 */
export class CampaignBodyError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
  }
}
