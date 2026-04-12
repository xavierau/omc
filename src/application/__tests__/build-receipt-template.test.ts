import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/layout-service/client')
vi.mock('@/infrastructure/supabase/repositories/layout-template-repository')

import { buildLayoutTemplate } from '@/infrastructure/layout-service/client'
import {
  archiveTemplates,
  createTemplate,
} from '@/infrastructure/supabase/repositories/layout-template-repository'
import { buildReceiptTemplate } from '../build-receipt-template'

const TEMPLATE_RESULT = {
  regions: [
    { name: 'logo', bbox: [0, 0, 100, 50] },
    { name: 'total', bbox: [0, 200, 100, 250] },
    { name: 'items', bbox: [0, 50, 100, 200] },
  ],
}

describe('buildReceiptTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(archiveTemplates).mockResolvedValue(undefined as never)
    vi.mocked(buildLayoutTemplate).mockResolvedValue(TEMPLATE_RESULT as never)
    vi.mocked(createTemplate).mockResolvedValue('tmpl-1' as never)
  })

  it('throws when too few images are provided', async () => {
    await expect(
      buildReceiptTemplate({
        restaurantId: 'rest-1',
        imageUrls: ['img1.jpg', 'img2.jpg'],
      })
    ).rejects.toThrow('Expected 3-5 images, got 2')

    expect(archiveTemplates).not.toHaveBeenCalled()
    expect(buildLayoutTemplate).not.toHaveBeenCalled()
  })

  it('throws when too many images are provided', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `img${i}.jpg`)

    await expect(
      buildReceiptTemplate({ restaurantId: 'rest-1', imageUrls: urls })
    ).rejects.toThrow('Expected 3-5 images, got 6')

    expect(archiveTemplates).not.toHaveBeenCalled()
  })

  it('archives, builds, creates template and returns id with region count', async () => {
    const imageUrls = ['img1.jpg', 'img2.jpg', 'img3.jpg']

    const result = await buildReceiptTemplate({
      restaurantId: 'rest-1',
      imageUrls,
    })

    expect(archiveTemplates).toHaveBeenCalledWith('rest-1')
    expect(buildLayoutTemplate).toHaveBeenCalledWith(imageUrls, 'rest-1')
    expect(createTemplate).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      templateJson: TEMPLATE_RESULT,
      sampleImageUrls: imageUrls,
      sampleCount: 3,
    })
    expect(result).toEqual({ templateId: 'tmpl-1', regionCount: 3 })
  })
})
