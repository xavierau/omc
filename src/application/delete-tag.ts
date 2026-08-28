// TAG-001: delete a tag. The repo scopes the delete by restaurant_id (lazy-flow
// authorization parity) so a tagId from another tenant yields TagNotFoundError.
// The DB cascade clears member_tags/campaign_tags rows.

import { tagRepository } from '@/infrastructure/supabase/repositories/tag-repository'

export interface DeleteTagInput {
  restaurantId: string
  tagId: string
}

export async function deleteTag(input: DeleteTagInput): Promise<void> {
  await tagRepository.remove(input.tagId, input.restaurantId)
}
