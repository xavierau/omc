/**
 * BOOK-014 W4 (spec AC-11): what the staff booking form needs to show
 * "Require deposit HK$X": the restaurant's deposit rule and currency, only
 * while the account can take charges (spec AC-4: otherwise no option). The
 * server recomputes the amount at create (R53); this is display only.
 * Admin or staff of the session's tenant. 200 {deposit: {mode, amount,
 * fromPartySize, currency} | null}.
 */
import { NextResponse } from 'next/server'
import { bookingSettingsReader } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { depositChannelPorts } from '@/application/payments/payment-deps'
import { isChargeable } from '@/domain/entities/merchant-payment-account'
import { NO_STORE, failure, staffContext } from '../staff-access'

export async function GET() {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const [config, account] = await Promise.all([
      bookingSettingsReader.getConfig(ctx.restaurantId),
      depositChannelPorts.accounts.findForRestaurant(ctx.restaurantId),
    ])
    const rule = config.deposit
    const deposit =
      rule.enabled && isChargeable(account)
        ? { mode: rule.mode, amount: rule.amount, fromPartySize: rule.fromPartySize, currency: account.currency }
        : null
    return NextResponse.json({ deposit }, { headers: NO_STORE })
  } catch (error) {
    return failure(error, 'read deposit rule')
  }
}
