'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { CouponListItem } from '@/hooks/use-coupons'

interface CouponFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  coupon?: CouponListItem | null
}

interface FormState {
  type: string
  code: string
  discountType: string
  discountValue: string
  maxUses: string
  expiresAt: string
  description: string
}

const initialForm: FormState = {
  type: 'shared', code: '', discountType: 'none', discountValue: '', maxUses: '', expiresAt: '', description: '',
}

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const generateCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes).map((b) => CHARSET[b % CHARSET.length]).join('')
}
const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

export function CouponFormDialog({ open, onClose, onSaved, coupon }: CouponFormDialogProps) {
  const t = useTranslations('coupons')
  const tc = useTranslations('common')
  const [form, setForm] = useState<FormState>(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = !!coupon

  useEffect(() => {
    if (coupon) {
      setForm({
        type: coupon.type,
        code: coupon.code,
        discountType: coupon.discountType ?? 'none',
        discountValue: coupon.discountValue?.toString() ?? '',
        maxUses: coupon.maxUses?.toString() ?? '',
        expiresAt: coupon.expiresAt?.slice(0, 10) ?? '',
        description: coupon.description ?? '',
      })
    } else {
      setForm(initialForm)
    }
  }, [coupon, open])

  const handleSubmit = async () => {
    if (!form.code.trim()) { setError(t('codeRequired')); return }
    if (!form.type) { setError(t('typeRequired')); return }

    setSaving(true)
    setError(null)
    try {
      const body = buildRequestBody(form)
      const url = isEdit ? `/api/dashboard/coupons/${coupon!.id}` : '/api/dashboard/coupons'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error('Failed to save coupon')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? t('editCoupon') : t('createCoupon')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          <CouponFormFields form={form} setForm={setForm} />
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          <div className="flex gap-2 mt-6">
            <Button onClick={handleSubmit} disabled={saving}>{saving ? tc('saving') : tc('save')}</Button>
            <Button variant="outline" onClick={onClose}>{tc('cancel')}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CouponFormFields({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const t = useTranslations('coupons')
  const tc = useTranslations('common')
  const u = (key: keyof FormState, value: string) => setForm({ ...form, [key]: value })

  return (
    <div className="space-y-4 mt-4">
      <Field label={t('formType')}>
        <select value={form.type} onChange={(e) => u('type', e.target.value)} className={selectClass}>
          <option value="shared">{t('shared')}</option><option value="promo">{t('promo')}</option><option value="reward">{t('reward')}</option>
        </select>
      </Field>
      <Field label={t('formCode')}>
        <div className="flex gap-2">
          <Input value={form.code} onChange={(e) => u('code', e.target.value.toUpperCase())} placeholder="PROMO-2024" />
          <Button variant="outline" size="sm" onClick={() => u('code', generateCode())}>{tc('generate')}</Button>
        </div>
      </Field>
      <Field label={t('formDiscountType')}>
        <select value={form.discountType} onChange={(e) => u('discountType', e.target.value)} className={selectClass}>
          <option value="none">{t('formNone')}</option><option value="percentage">{t('formPercentage')}</option><option value="fixed_amount">{t('formFixedAmount')}</option>
        </select>
      </Field>
      {form.discountType !== 'none' && (
        <Field label={t('formDiscountValue')}>
          <Input type="number" value={form.discountValue} onChange={(e) => u('discountValue', e.target.value)} placeholder={form.discountType === 'percentage' ? '20' : '50'} />
        </Field>
      )}
      <Field label={t('formMaxUses')}>
        <Input type="number" value={form.maxUses} onChange={(e) => u('maxUses', e.target.value)} placeholder="100" />
      </Field>
      <Field label={t('formExpiresAt')}>
        <Input type="date" value={form.expiresAt} onChange={(e) => u('expiresAt', e.target.value)} />
      </Field>
      <Field label={t('formDescription')}>
        <textarea value={form.description} onChange={(e) => u('description', e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]" placeholder={t('formDescriptionPlaceholder')} />
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-sm font-medium text-foreground mb-1 block">{label}</label>{children}</div>
}

function buildRequestBody(form: FormState) {
  return {
    type: form.type, code: form.code,
    discountType: form.discountType === 'none' ? null : form.discountType,
    discountValue: form.discountType === 'none' ? null : Number(form.discountValue) || null,
    maxUses: form.maxUses ? Number(form.maxUses) : null,
    expiresAt: form.expiresAt || null, description: form.description || null,
  }
}
