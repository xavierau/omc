'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRewards, RewardItem } from '@/hooks/use-rewards'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface FormState {
  name: string; pointsCost: string; discountType: string
  discountValue: string; couponExpiryDays: string; sortOrder: string
}

const initialForm: FormState = {
  name: '', pointsCost: '', discountType: 'percentage',
  discountValue: '', couponExpiryDays: '30', sortOrder: '0',
}

export default function RewardsPage() {
  const t = useTranslations('rewards')
  const tc = useTranslations('common')
  const { data, isLoading, error, refetch } = useRewards()
  const [formOpen, setFormOpen] = useState(false)
  const [editReward, setEditReward] = useState<RewardItem | null>(null)

  const handleCreate = () => { setEditReward(null); setFormOpen(true) }
  const handleEdit = (r: RewardItem) => { setEditReward(r); setFormOpen(true) }

  const handleToggle = useCallback(async (r: RewardItem) => {
    try {
      await fetch('/api/dashboard/rewards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r.id, isActive: !r.isActive }),
      })
      refetch()
    } catch { /* swallow */ }
  }, [refetch])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">{t('couldntLoad')}</p>
        <Button variant="outline" onClick={refetch} className="mt-4">{tc('retry')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <Button onClick={handleCreate}>{t('addReward')}</Button>
      </div>
      <RewardsContent rewards={data} isLoading={isLoading} onEdit={handleEdit} onToggle={handleToggle} />
      <RewardFormSheet open={formOpen} onClose={() => setFormOpen(false)} onSaved={refetch} reward={editReward} />
    </div>
  )
}

const TH = 'px-4 py-2 font-medium'
const TD = 'px-4 py-2'
const fmtDiscount = (r: RewardItem) => r.discountType === 'percentage' ? `${r.discountValue}%` : `HK$${r.discountValue}`
const statusCls = (active: boolean) => `inline-block rounded-full px-2 py-0.5 text-xs font-medium ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`

function RewardsContent({ rewards, isLoading, onEdit, onToggle }: {
  rewards: RewardItem[] | null; isLoading: boolean
  onEdit: (r: RewardItem) => void; onToggle: (r: RewardItem) => void
}) {
  const t = useTranslations('rewards')
  if (isLoading) return <LoadingSkeleton />
  if (!rewards?.length) return <EmptyState title={t('noRewardsTitle')} description={t('noRewardsDescription')} />
  const cols = ['name', 'pointsCost', 'discount', 'expiryDays', 'status', 'actions'] as const
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>{cols.map((c) => <th key={c} className={TH}>{t(c)}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rewards.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <td className={TD}>{r.name}</td>
              <td className={TD}>{r.pointsCost}</td>
              <td className={TD}>{fmtDiscount(r)}</td>
              <td className={TD}>{r.couponExpiryDays}d</td>
              <td className={TD}><span className={statusCls(r.isActive)}>{r.isActive ? 'Active' : 'Inactive'}</span></td>
              <td className={`${TD} flex gap-1`}>
                <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>{t('editReward')}</Button>
                <Button variant="ghost" size="sm" onClick={() => onToggle(r)}>{r.isActive ? 'Deactivate' : 'Activate'}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RewardFormSheet({ open, onClose, onSaved, reward }: {
  open: boolean; onClose: () => void; onSaved: () => void; reward: RewardItem | null
}) {
  const t = useTranslations('rewards')
  const tc = useTranslations('common')
  const isEdit = !!reward
  const [form, setForm] = useState<FormState>(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (reward) {
      setForm({
        name: reward.name, pointsCost: String(reward.pointsCost),
        discountType: reward.discountType, discountValue: String(reward.discountValue),
        couponExpiryDays: String(reward.couponExpiryDays), sortOrder: String(reward.sortOrder),
      })
    } else { setForm(initialForm) }
  }, [reward, open])

  const u = (key: keyof FormState, val: string) => setForm((f) => ({ ...f, [key]: val }))
  const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError(t('nameRequired')); return }
    if (!form.pointsCost) { setError(t('pointsCostRequired')); return }
    setSaving(true); setError(null)
    try {
      const body = {
        ...(isEdit ? { id: reward!.id } : {}),
        name: form.name, pointsCost: Number(form.pointsCost),
        discountType: form.discountType, discountValue: Number(form.discountValue) || 0,
        couponExpiryDays: Number(form.couponExpiryDays) || 30, sortOrder: Number(form.sortOrder) || 0,
      }
      const res = await fetch('/api/dashboard/rewards', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to save')
      onSaved(); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'Unknown error') }
    finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader><SheetTitle>{isEdit ? t('editReward') : t('addReward')}</SheetTitle></SheetHeader>
        <div className="px-4 pb-4 space-y-4 mt-4">
          <Field label={t('formName')}><Input value={form.name} onChange={(e) => u('name', e.target.value)} placeholder={t('formNamePlaceholder')} /></Field>
          <Field label={t('formPointsCost')}><Input type="number" value={form.pointsCost} onChange={(e) => u('pointsCost', e.target.value)} /></Field>
          <Field label={t('formDiscountType')}>
            <select value={form.discountType} onChange={(e) => u('discountType', e.target.value)} className={selectClass}>
              <option value="percentage">{t('percentage')}</option><option value="fixed_amount">{t('fixedAmount')}</option>
            </select>
          </Field>
          <Field label={t('formDiscountValue')}><Input type="number" value={form.discountValue} onChange={(e) => u('discountValue', e.target.value)} /></Field>
          <Field label={t('formExpiryDays')}><Input type="number" value={form.couponExpiryDays} onChange={(e) => u('couponExpiryDays', e.target.value)} /></Field>
          <Field label={t('formSortOrder')}><Input type="number" value={form.sortOrder} onChange={(e) => u('sortOrder', e.target.value)} /></Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 mt-6">
            <Button onClick={handleSubmit} disabled={saving}>{saving ? tc('saving') : tc('save')}</Button>
            <Button variant="outline" onClick={onClose}>{tc('cancel')}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-sm font-medium text-foreground mb-1 block">{label}</label>{children}</div>
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />)}
    </div>
  )
}
