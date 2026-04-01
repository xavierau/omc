import { buildLayoutTemplate } from '@/infrastructure/layout-service/client'
import {
  archiveTemplates,
  createTemplate,
} from '@/infrastructure/supabase/repositories/layout-template-repository'

const MIN_IMAGES = 3
const MAX_IMAGES = 5

export async function buildReceiptTemplate(params: {
  restaurantId: string
  imageUrls: string[]
}): Promise<{ templateId: string; regionCount: number }> {
  const { restaurantId, imageUrls } = params

  validateImageCount(imageUrls.length)

  await archiveTemplates(restaurantId)

  const template = await buildLayoutTemplate(imageUrls, restaurantId)

  const templateId = await createTemplate({
    restaurantId,
    templateJson: template,
    sampleImageUrls: imageUrls,
    sampleCount: imageUrls.length,
  })

  return { templateId, regionCount: template.regions.length }
}

function validateImageCount(count: number): void {
  if (count < MIN_IMAGES || count > MAX_IMAGES) {
    throw new Error(`Expected ${MIN_IMAGES}-${MAX_IMAGES} images, got ${count}`)
  }
}
