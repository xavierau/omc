import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-quality-state', () => ({
  throttleMemberPmm: vi.fn(),
  markMemberUnreachable: vi.fn(),
}))
vi.mock('@/application/emit-ops-alert', () => ({
  emitOpsAlert: vi.fn(),
}))

import {
  throttleMemberPmm,
  markMemberUnreachable,
} from '@/infrastructure/supabase/repositories/member-quality-state'
import { emitOpsAlert } from '@/application/emit-ops-alert'
import { dispatchErrorAction } from '../dispatch-error-action'
import { WhatsAppMessage } from '@/domain/entities/whatsapp-message'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

function buildFailedMessage(
  errorCode: string | null,
  memberId: string | null = 'mem-1'
): WhatsAppMessage {
  return WhatsAppMessage.fromProps({
    id: 'msg-1',
    restaurantId: 'rest-1',
    memberId,
    campaignId: 'camp-1',
    phoneE164: '85291234567',
    direction: 'outbound',
    category: 'marketing',
    messageType: 'template',
    templateId: 'tpl-1',
    templateName: 'promo_v1',
    contentPreview: 'Hi',
    kapsoMessageId: 'wamid.AAA',
    status: 'failed',
    errorCode,
    errorTitle: 'fail',
    errorDetails: 'details',
    queuedAt: '2026-05-04T10:00:00.000Z',
    sentAt: '2026-05-04T10:00:01.000Z',
    deliveredAt: null,
    readAt: null,
    failedAt: '2026-05-04T10:00:05.000Z',
  })
}

describe('dispatchErrorAction', () => {
  let logs: Array<[string, string, unknown]>
  const log: LogFn = (level, event, data) => {
    logs.push([level, event, data])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
  })

  // --- Member-mutation branches -------------------------------------------

  it('131049 → throttleMemberPmm(memberId, 24); no ops alert; warn log', async () => {
    await dispatchErrorAction(buildFailedMessage('131049'), 'rest-1', log)

    expect(throttleMemberPmm).toHaveBeenCalledTimes(1)
    expect(throttleMemberPmm).toHaveBeenCalledWith('mem-1', 24)
    expect(markMemberUnreachable).not.toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry?.[0]).toBe('warn')
    expect(entry?.[2]).toMatchObject({
      code: '131049',
      action: 'throttle_recipient_24h',
      restaurantId: 'rest-1',
      kapsoMessageId: 'wamid.AAA',
    })
  })

  it('131026 → markMemberUnreachable(memberId); no ops alert; warn log', async () => {
    await dispatchErrorAction(buildFailedMessage('131026'), 'rest-1', log)

    expect(markMemberUnreachable).toHaveBeenCalledTimes(1)
    expect(markMemberUnreachable).toHaveBeenCalledWith('mem-1')
    expect(throttleMemberPmm).not.toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry?.[0]).toBe('warn')
    expect(entry?.[2]).toMatchObject({ action: 'mark_recipient_unreachable' })
  })

  // --- Ops-alert branches --------------------------------------------------

  it('131045 → emitOpsAlert(block_template); no member mutation; error log', async () => {
    await dispatchErrorAction(buildFailedMessage('131045'), 'rest-1', log)

    expect(emitOpsAlert).toHaveBeenCalledTimes(1)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'block_template',
        restaurantId: 'rest-1',
      })
    )
    expect(throttleMemberPmm).not.toHaveBeenCalled()
    expect(markMemberUnreachable).not.toHaveBeenCalled()
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry?.[0]).toBe('error')
  })

  it('131051 → emitOpsAlert(engineering_alert); error log', async () => {
    await dispatchErrorAction(buildFailedMessage('131051'), 'rest-1', log)

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'engineering_alert' })
    )
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry?.[0]).toBe('error')
  })

  it('132100 → emitOpsAlert(policy_violation_alert); critical log', async () => {
    await dispatchErrorAction(buildFailedMessage('132100'), 'rest-1', log)

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'policy_violation_alert' })
    )
    expect(throttleMemberPmm).not.toHaveBeenCalled()
    expect(markMemberUnreachable).not.toHaveBeenCalled()
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry?.[0]).toBe('critical')
  })

  it('unknown_code → emitOpsAlert(engineering_alert); error log', async () => {
    await dispatchErrorAction(
      buildFailedMessage('unknown_code'),
      'rest-1',
      log
    )

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'engineering_alert' })
    )
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry?.[0]).toBe('error')
  })

  // --- Log-only branches (no DB mutation, no alert) -----------------------

  it('131047 → log_only / info; no mutation, no alert', async () => {
    await dispatchErrorAction(buildFailedMessage('131047'), 'rest-1', log)

    expect(throttleMemberPmm).not.toHaveBeenCalled()
    expect(markMemberUnreachable).not.toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry?.[0]).toBe('info')
  })

  it('131048 → reduce_batch_size / warn; no mutation, no alert', async () => {
    await dispatchErrorAction(buildFailedMessage('131048'), 'rest-1', log)

    expect(throttleMemberPmm).not.toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry?.[0]).toBe('warn')
  })

  it('131056 → backoff_and_retry / warn; no mutation, no alert', async () => {
    await dispatchErrorAction(buildFailedMessage('131056'), 'rest-1', log)

    expect(throttleMemberPmm).not.toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry?.[0]).toBe('warn')
  })

  // --- Critical guards ----------------------------------------------------

  it('internal_orphan → log only; NO member mutation, NO ops alert (forensic noise from reconciliation sweep)', async () => {
    await dispatchErrorAction(
      buildFailedMessage('internal_orphan'),
      'rest-1',
      log
    )

    expect(throttleMemberPmm).not.toHaveBeenCalled()
    expect(markMemberUnreachable).not.toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry).toBeDefined()
    expect(entry?.[2]).toMatchObject({
      code: 'internal_orphan',
      action: 'log_only',
    })
  })

  it('memberId is null on a 131049 → no throttle call, no crash, just log', async () => {
    await dispatchErrorAction(
      buildFailedMessage('131049', null),
      'rest-1',
      log
    )

    expect(throttleMemberPmm).not.toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
    const entry = logs.find((l) => l[1] === 'whatsapp.error_dispatched')
    expect(entry).toBeDefined()
  })

  it('memberId is null on a 131026 → no markUnreachable call, no crash', async () => {
    await dispatchErrorAction(
      buildFailedMessage('131026', null),
      'rest-1',
      log
    )

    expect(markMemberUnreachable).not.toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })
})
