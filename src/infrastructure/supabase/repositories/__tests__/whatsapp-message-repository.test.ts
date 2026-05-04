import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { attachKapsoMessageId } from '../whatsapp-message-repository'

interface QueryRecorder {
  update: Record<string, unknown> | null
  eqs: Array<{ col: string; val: unknown }>
}

function buildUpdateClient(opts: { error: { message: string } | null } = { error: null }): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: QueryRecorder
} {
  const recorder: QueryRecorder = { update: null, eqs: [] }
  // The chain we need: .from('whatsapp_messages').update(payload).eq('id', id).eq('status', 'queued')
  // The terminal eq() (the second one) resolves to { error }.
  // This represents both "rows matched, update applied" and "no rows matched"
  // (Supabase returns `{ data: null, error: null }` for no-match UPDATEs by default).
  const eqTerminal = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return Promise.resolve({ data: null, error: opts.error })
  })
  const eqFirst = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return { eq: eqTerminal }
  })
  const update = vi.fn().mockImplementation((u: Record<string, unknown>) => {
    recorder.update = u
    return { eq: eqFirst }
  })
  const from = vi.fn().mockReturnValue({ update })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

describe('attachKapsoMessageId — status guard + raw payload (FIX 1+2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('issues a status-guarded UPDATE that includes raw_send_response', async () => {
    const { client, recorder } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const raw = { messages: [{ id: 'wamid.X' }] }
    await attachKapsoMessageId('local-uuid-1', 'wamid.X', raw)

    expect(recorder.update).toEqual({
      kapso_message_id: 'wamid.X',
      raw_send_response: raw,
      status: 'sent',
      sent_at: expect.any(String),
    })
    // Must call .eq('id', ...) AND .eq('status', 'queued') — second eq is the
    // race guard that prevents regressing a delivered/read row back to sent.
    expect(recorder.eqs).toEqual([
      { col: 'id', val: 'local-uuid-1' },
      { col: 'status', val: 'queued' },
    ])
  })

  it('persists null raw payload when caller has no BSP body', async () => {
    const { client, recorder } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await attachKapsoMessageId('local-uuid-2', 'wamid.Y', null)

    expect(recorder.update?.raw_send_response).toBe(null)
  })

  it('is a no-op (no error thrown) when the row has already advanced past queued', async () => {
    // Supabase returns { data: null, error: null } when the UPDATE matches no
    // rows — this is the intended behavior for a row whose webhook arrived
    // first and progressed status to delivered/read. We must not throw.
    const { client } = buildUpdateClient({ error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      attachKapsoMessageId('local-uuid-3', 'wamid.Z', null)
    ).resolves.toBeUndefined()
  })

  it('throws a contextual error when the database itself returns an error', async () => {
    const { client } = buildUpdateClient({ error: { message: 'permission denied' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      attachKapsoMessageId('local-uuid-4', 'wamid.W', null)
    ).rejects.toThrow('attachKapsoMessageId: permission denied')
  })
})
