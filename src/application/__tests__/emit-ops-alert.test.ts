import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))
vi.mock('@/application/notify-ops-alert', () => ({
  notifyOpsAlert: vi.fn().mockResolvedValue(undefined),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { emitOpsAlert } from '../emit-ops-alert'
import { notifyOpsAlert } from '@/application/notify-ops-alert'
import { WhatsAppMessage } from '@/domain/entities/whatsapp-message'

interface InsertRecorder {
  table: string | null
  rows: Array<Record<string, unknown>>
}

function buildSupabase(returnedError: { message: string } | null = null): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: InsertRecorder
} {
  const recorder: InsertRecorder = { table: null, rows: [] }
  const insert = vi
    .fn()
    .mockImplementation(async (row: Record<string, unknown>) => {
      recorder.rows.push(row)
      return { error: returnedError }
    })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { insert }
  })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

function buildMessage(
  overrides: Partial<WhatsAppMessage['snapshot']> = {}
): WhatsAppMessage {
  return WhatsAppMessage.fromProps({
    id: 'msg-1',
    restaurantId: 'rest-1',
    memberId: 'mem-1',
    campaignId: null,
    phoneE164: '85291234567',
    direction: 'outbound',
    category: 'marketing',
    messageType: 'template',
    templateId: 'tpl-1',
    templateName: 'promo_v1',
    contentPreview: 'Hi',
    kapsoMessageId: 'wamid.AAA',
    status: 'failed',
    errorCode: '131045',
    errorTitle: 'Template not approved',
    errorDetails: 'Template was disabled',
    queuedAt: '2026-05-04T10:00:00.000Z',
    sentAt: '2026-05-04T10:00:01.000Z',
    deliveredAt: null,
    readAt: null,
    failedAt: '2026-05-04T10:00:05.000Z',
    ...overrides,
  })
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('emitOpsAlert', () => {
  it('inserts an events row with type=whatsapp_error and the alert payload', async () => {
    const { client, recorder } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const message = buildMessage()
    await emitOpsAlert({
      kind: 'block_template',
      message,
      restaurantId: 'rest-1',
    })

    expect(recorder.table).toBe('events')
    expect(recorder.rows).toHaveLength(1)
    const row = recorder.rows[0]
    expect(row.restaurant_id).toBe('rest-1')
    expect(row.type).toBe('whatsapp_error')
    expect(row.data_json).toMatchObject({
      kind: 'block_template',
      error_code: '131045',
      action: 'block_template',
      kapso_message_id: 'wamid.AAA',
      error_title: 'Template not approved',
      error_details: 'Template was disabled',
    })
  })

  it('always emits a console.error so log aggregators surface the alert', async () => {
    const { client } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await emitOpsAlert({
      kind: 'engineering_alert',
      message: buildMessage({ errorCode: '131051' }),
      restaurantId: 'rest-1',
    })

    expect(consoleErrorSpy).toHaveBeenCalled()
    const args = consoleErrorSpy.mock.calls[0]
    expect(args[0]).toBe('[ops_alert]')
    expect(args[1]).toBe('engineering_alert')
  })

  it('does NOT throw when the events insert fails — losing an alert is bad but losing a member mutation upstream is worse', async () => {
    const { client } = buildSupabase({ message: 'db down' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      emitOpsAlert({
        kind: 'policy_violation_alert',
        message: buildMessage({ errorCode: '132100' }),
        restaurantId: 'rest-1',
      })
    ).resolves.toBeUndefined()

    // The console.error path still fires so the alert is at least observable
    // in stdout (twice — once for the original alert, once for the DB failure).
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  // WAQ-013: live notification on top of the audit trail.
  describe('notifyOpsAlert wiring (WAQ-013)', () => {
    it('block_template → notifyOpsAlert(kind=block_template, severity=error)', async () => {
      const { client } = buildSupabase()
      vi.mocked(createServerSupabaseClient).mockReturnValue(client)

      await emitOpsAlert({
        kind: 'block_template',
        message: buildMessage({ errorCode: '131045' }),
        restaurantId: 'rest-1',
      })

      expect(notifyOpsAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'block_template',
          severity: 'error',
          restaurantId: 'rest-1',
        })
      )
    })

    it('engineering_alert → notifyOpsAlert(kind=engineering_alert, severity=error)', async () => {
      const { client } = buildSupabase()
      vi.mocked(createServerSupabaseClient).mockReturnValue(client)

      await emitOpsAlert({
        kind: 'engineering_alert',
        message: buildMessage({ errorCode: '131051' }),
        restaurantId: 'rest-1',
      })

      expect(notifyOpsAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'engineering_alert',
          severity: 'error',
        })
      )
    })

    it('policy_violation_alert → notifyOpsAlert(kind=policy_violation, severity=critical)', async () => {
      const { client } = buildSupabase()
      vi.mocked(createServerSupabaseClient).mockReturnValue(client)

      await emitOpsAlert({
        kind: 'policy_violation_alert',
        message: buildMessage({ errorCode: '132100' }),
        restaurantId: 'rest-1',
      })

      expect(notifyOpsAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'policy_violation',
          severity: 'critical',
        })
      )
    })

    it('does NOT throw when notifyOpsAlert rejects', async () => {
      const { client } = buildSupabase()
      vi.mocked(createServerSupabaseClient).mockReturnValue(client)
      vi.mocked(notifyOpsAlert).mockRejectedValueOnce(new Error('slack down'))

      await expect(
        emitOpsAlert({
          kind: 'block_template',
          message: buildMessage({ errorCode: '131045' }),
          restaurantId: 'rest-1',
        })
      ).resolves.toBeUndefined()
    })
  })
})
