/**
 * BOOK-014 W2 (spec S1 AC-1, AC-2; threat R52, R58): the restaurant's
 * payment account status for Settings → Booking → Payments. Any tenant
 * member may read it (status only, never the provider account id); the
 * restaurant comes from the session.
 *
 * `?refresh=1` (sent by the page after the provider's onboarding return or
 * refresh redirect, admins only) re-reads the STORED account from the
 * provider and saves the result. Nothing else in the URL is read: an
 * `?account=…` on the return URL changes nothing (R52).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { isTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { paymentAccountDeps } from '@/application/payments/payment-deps'
import { paymentAccountView, refreshPaymentAccount } from '@/application/payments/payment-account'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const admin = isTenantAdmin(ctx)
    const deps = paymentAccountDeps()
    const refresh = admin && request.nextUrl.searchParams.get('refresh') === '1'
    const account = refresh
      ? await refreshPaymentAccount(deps, { restaurantId: ctx.restaurantId })
      : await deps.accounts.findForRestaurant(ctx.restaurantId)
    return NextResponse.json({ account: paymentAccountView(account), canManage: admin })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode })
    console.error('[Payments] account read failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load payment account' }, { status: 500 })
  }
}
