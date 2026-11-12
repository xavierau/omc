// TAG-001: list a tenant's tags. Tenant-scoped in the repo (restaurant_id).

import type { Tag } from '@/domain/entities/tag'
import { tagRepository } from '@/infrastructure/supabase/repositories/tag-repository'

export function listTags(restaurantId: string): Promise<Tag[]> {
  return tagRepository.listByRestaurant(restaurantId)
}
