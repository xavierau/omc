export interface SubmitOutcome {
  error: string | null
  refetch: boolean
  close: boolean
}

interface SubmitBody {
  template?: unknown
  error?: string
  warning?: string
}

async function readBody(res: Response): Promise<SubmitBody> {
  try {
    return (await res.json()) as SubmitBody
  } catch {
    return {}
  }
}

/**
 * Meta rejections (422) and provider failures (502) still carry a saved row, so the
 * list must refetch even though the sheet stays open on the error. Save-time
 * validation (400) creates nothing.
 */
export async function readSubmitOutcome(res: Response, fallback: string): Promise<SubmitOutcome> {
  if (res.ok) return { error: null, refetch: true, close: true }
  const body = await readBody(res)
  return {
    error: body.error ?? body.warning ?? fallback,
    refetch: Boolean(body.template),
    close: false,
  }
}
