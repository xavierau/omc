'use client'

import { useTranslations } from 'next-intl'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CouponListItem } from '@/hooks/use-coupons'

interface CouponTableProps {
  coupons: CouponListItem[]
  search: string
  onSearchChange: (value: string) => void
  typeFilter: string
  onTypeFilterChange: (value: string) => void
  onSelectCoupon: (id: string) => void
  onToggleActive: (id: string, isActive: boolean) => void
}

function formatDiscount(type: string | null, value: number | null): string {
  if (!type || value == null) return '\u2014'
  if (type === 'percentage') return `${value}%`
  return `HK$${value}`
}

function formatUses(current: number, max: number | null): string {
  return `${current}/${max ?? '\u221E'}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014'
  return new Date(dateStr).toLocaleDateString('en-HK', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function CouponTable({
  coupons, search, onSearchChange, typeFilter, onTypeFilterChange, onSelectCoupon, onToggleActive,
}: CouponTableProps) {
  const t = useTranslations('coupons')
  const tc = useTranslations('common')

  const columns = [
    t('code'), t('type'), t('discount'), t('uses'),
    tc('active'), t('expires'), t('actions'),
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t('allTypes')}</option>
          <option value="welcome">{t('welcome')}</option>
          <option value="promo">{t('promo')}</option>
          <option value="reward">{t('reward')}</option>
          <option value="shared">{t('shared')}</option>
        </select>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col}>{col}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {coupons.map((coupon) => (
              <CouponRow
                key={coupon.id}
                coupon={coupon}
                onSelect={onSelectCoupon}
                onToggle={onToggleActive}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function CouponRow({ coupon, onSelect, onToggle }: {
  coupon: CouponListItem
  onSelect: (id: string) => void
  onToggle: (id: string, isActive: boolean) => void
}) {
  const tc = useTranslations('common')

  return (
    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => onSelect(coupon.id)}>
      <TableCell className="font-mono font-medium">{coupon.code}</TableCell>
      <TableCell><Badge variant="secondary">{coupon.type}</Badge></TableCell>
      <TableCell>{formatDiscount(coupon.discountType, coupon.discountValue)}</TableCell>
      <TableCell>{formatUses(coupon.currentUses, coupon.maxUses)}</TableCell>
      <TableCell>
        <Badge variant={coupon.isActive ? 'default' : 'secondary'}>
          {coupon.isActive ? tc('active') : tc('inactive')}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(coupon.expiresAt)}</TableCell>
      <TableCell>
        <Button
          variant="outline"
          size="xs"
          onClick={(e) => { e.stopPropagation(); onToggle(coupon.id, !coupon.isActive) }}
        >
          {coupon.isActive ? tc('deactivate') : tc('activate')}
        </Button>
      </TableCell>
    </TableRow>
  )
}
