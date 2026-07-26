// Dedicated integration-style file (separate from deploy-contact-flow.test.ts
// which mocks the whole flow-client module for isolation): here flow-client
// is REAL, only the Kapso SDK's WhatsAppClient class is stubbed. This proves
// the CodeRabbit-flagged bug is actually fixed end-to-end — `--force`
// deprecates the previous flow then creates a new one, and with a fixed flow
// name that create used to collide with the name it had just deprecated
// (Meta error 100, "Flow name is not unique"). With per-attempt unique
// names, two successive `forceDeploy` calls (the repeated-upgrade scenario)
// must both succeed against the same mocked SDK without any name-collision
// simulation needed — a collision is structurally impossible now.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/kapso/template-client')

const mockCreate = vi.fn()
const mockPublish = vi.fn()
const mockDeprecate = vi.fn()
vi.mock('@kapso/whatsapp-cloud-api', async () => {
  const actual = await vi.importActual<typeof import('@kapso/whatsapp-cloud-api')>(
    '@kapso/whatsapp-cloud-api'
  )
  return {
    ...actual,
    WhatsAppClient: class {
      flows = { create: mockCreate, publish: mockPublish, deprecate: mockDeprecate }
    },
  }
})

import { forceDeploy } from './deploy-contact-flow'
import {
  getContactFlowId,
  updateContactFlowId,
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveWabaId } from '@/infrastructure/kapso/template-client'

const RESTAURANT_ID = 'rest-1'
const KAPSO_API_KEY = 'key-abc'

describe('forceDeploy — real flow-client, no name collision across repeated upgrades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('KAPSO_API_KEY', KAPSO_API_KEY)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-1')
    vi.mocked(resolveWabaId).mockResolvedValue('derived-waba')
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('stored-waba')
    vi.mocked(updateMetaBusinessAccountId).mockResolvedValue(undefined)
    vi.mocked(updateContactFlowId).mockResolvedValue(undefined)
    mockCreate.mockImplementation(async (options: { name: string }) => ({
      id: `flow-${options.name}`,
    }))
    mockPublish.mockResolvedValue(undefined)
    mockDeprecate.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('succeeds on a second --force upgrade against the flow the first upgrade just deprecated', async () => {
    vi.mocked(getContactFlowId).mockResolvedValueOnce(null)

    const first = await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)
    expect(first.ok).toBe(true)

    vi.mocked(getContactFlowId).mockResolvedValueOnce(first.ok ? first.flowId : null)

    const second = await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)

    expect(second.ok).toBe(true)
    expect(mockCreate).toHaveBeenCalledTimes(2)
    const firstName = mockCreate.mock.calls[0][0].name
    const secondName = mockCreate.mock.calls[1][0].name
    expect(firstName).not.toBe(secondName)
    expect(mockDeprecate).toHaveBeenCalledTimes(1)
  })
})
