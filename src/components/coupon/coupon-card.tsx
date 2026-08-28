import type { CouponPublicDTO } from '@/application/get-coupon-by-code'

function formatDiscount(type: CouponPublicDTO['discountType'], value: CouponPublicDTO['discountValue']): string | null {
  if (!type || value == null) return null
  if (type === 'percentage') return `${value}% OFF`
  return `HK$${value} OFF`
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'No expiration'
  return `Expires ${new Date(expiresAt).toLocaleDateString('en-HK', { year: 'numeric', month: 'short', day: 'numeric' })}`
}

const statusStyles: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  redeemed: 'bg-gray-100 text-gray-600',
  expired: 'bg-red-100 text-red-800',
}

export function CouponCard(props: CouponPublicDTO & { children?: React.ReactNode }) {
  const discount = formatDiscount(props.discountType, props.discountValue)
  const heroText = props.title ?? discount ?? 'Special Offer'

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[props.status]}`}>
          {props.status.charAt(0).toUpperCase() + props.status.slice(1)}
        </span>
        <span className="text-xs text-muted-foreground">{formatExpiry(props.expiresAt)}</span>
      </div>

      <p className="text-center text-3xl font-extrabold tracking-tight">{heroText}</p>

      {discount && props.title && (
        <p className="mt-2 text-center text-lg font-semibold text-primary">{discount}</p>
      )}

      {props.description && (
        <p className="mt-2 text-center text-sm text-muted-foreground">{props.description}</p>
      )}

      <div className="mt-6 rounded-lg bg-muted/50 px-4 py-3 text-center">
        <p className="font-mono text-lg tracking-widest">{props.code}</p>
      </div>

      {props.children && <div className="mt-6">{props.children}</div>}
    </div>
  )
}
