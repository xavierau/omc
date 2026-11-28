/**
 * BOOK-014 W2 (spec S1 AC-1, AC-2; threat R52, R58): "Connect Stripe" /
 * "Continue setup". Admin only. The provider account is created here, server
 * side, for the session's restaurant and stored before the onboarding link is
 * issued; the body is never read, so no caller can name an account or a
 * restaurant. The answer is the link the browser goes to.
 *
 * 200 {url} · 409 already_active · 502 provider_unavailable (UI: "Couldn't
 * reach Stripe, try again") · 403 non-admin.
 */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { paymentAccountDeps } from '@/application/payments/payment-deps'
import { connectPaymentAccount } from '@/application/payments/payment-account'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const result = await connectPaymentAccount(paymentAccountDeps(), { restaurantId: ctx.restaurantId })
    if (result.kind === 'link') return NextResponse.json({ url: result.url })
    if (result.kind === 'already_active') return NextResponse.json({ error: 'already_active' }, { status: 409 })
    return NextResponse.json({ error: 'provider_unavailable' }, { status: 502 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode })
    console.error('[Payments] connect failed:', (error as Error).message)
    return NextResponse.json({ error: 'provider_unavailable' }, { status: 502 })
  }
}
