import { describe, it, expect } from 'vitest'
import { readSubmitOutcome } from '@/components/dashboard/wa-template-submit'

const FALLBACK = 'Could not submit the template.'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('readSubmitOutcome', () => {
  it('closes the sheet and refetches on a 201 create', async () => {
    const res = jsonResponse(201, { template: { id: 't-1' } })
    expect(await readSubmitOutcome(res, FALLBACK)).toEqual({ error: null, refetch: true, close: true })
  })

  it('closes the sheet and refetches on a 200 edit', async () => {
    const res = jsonResponse(200, { template: { id: 't-1' } })
    expect(await readSubmitOutcome(res, FALLBACK)).toEqual({ error: null, refetch: true, close: true })
  })

  it("surfaces Meta's real reason on 422 and keeps the sheet open", async () => {
    const res = jsonResponse(422, { template: { id: 't-1' }, error: 'Meta says no' })
    const outcome = await readSubmitOutcome(res, FALLBACK)
    expect(outcome.error).toBe('Meta says no')
    expect(outcome.close).toBe(false)
  })

  it('still refetches on 422 because the row was created', async () => {
    const res = jsonResponse(422, { template: { id: 't-1' }, error: 'Meta says no' })
    expect((await readSubmitOutcome(res, FALLBACK)).refetch).toBe(true)
  })

  it('surfaces the provider error on 502 and refetches (a row exists)', async () => {
    const res = jsonResponse(502, { template: { id: 't-1' }, error: 'WhatsApp provider not configured' })
    expect(await readSubmitOutcome(res, FALLBACK)).toEqual({
      error: 'WhatsApp provider not configured',
      refetch: true,
      close: false,
    })
  })

  it('shows the save-time validation error on 400 without refetching (no row created)', async () => {
    const res = jsonResponse(400, { error: 'Image headers need a 4: handle' })
    expect(await readSubmitOutcome(res, FALLBACK)).toEqual({
      error: 'Image headers need a 4: handle',
      refetch: false,
      close: false,
    })
  })

  it('falls back to warning when the failure body carries no error', async () => {
    const res = jsonResponse(422, { template: { id: 't-1' }, warning: 'Submitted but not accepted' })
    expect((await readSubmitOutcome(res, FALLBACK)).error).toBe('Submitted but not accepted')
  })

  it('falls back to the generic message when the body explains nothing', async () => {
    const res = jsonResponse(500, {})
    expect((await readSubmitOutcome(res, FALLBACK)).error).toBe(FALLBACK)
  })

  it('falls back to the generic message when the body is not JSON', async () => {
    const res = new Response('<html>Bad Gateway</html>', { status: 502 })
    expect((await readSubmitOutcome(res, FALLBACK)).error).toBe(FALLBACK)
  })
})
