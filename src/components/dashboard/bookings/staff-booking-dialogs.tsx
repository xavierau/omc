'use client'

/**
 * BOOK-013 (mockup frames 1–6): the staff booking form (a dialog on desktop,
 * a bottom sheet on a phone), the rules prompt (warn, Book anyway: owner
 * decision 3), the stale banner (AC-11), the cancel dialog (AC-12, AC-13)
 * and the toast. Text the diner typed renders as plain text only.
 * BOOK-014 W4: the cancel dialog asks what happens to a paid deposit
 * (Refund / Keep / Decide later, spec AC-13); the toast after a deposit
 * booking whose link did not go out carries Copy link (spec UI states).
 */
import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, CheckCircle2, Copy, X } from 'lucide-react'
import { formatMoney } from '@/domain/value-objects/money'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BrokenRule } from '@/domain/services/staff-booking-rules'
import { formatDate } from './booking-dates'
import { changedFormFields } from './staff-booking-api'
import { NotifyCheck, StaffBookingFields } from './staff-booking-fields'
import type { CancelDepositChoice, StaffBookingController, Toast, ToastKind } from './use-staff-booking'
import { useIsPhone } from './use-media'

/** Desktop: a centred dialog; phone: a bottom sheet (frame 6). */
// `!`: the sheet's own `data-[side=bottom]:inset-x-0 bottom-0` would otherwise win on specificity.
const DIALOG = 'max-h-[92dvh] overflow-y-auto md:right-auto! md:bottom-auto! md:left-1/2! md:top-[6vh] md:w-[min(560px,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-xl md:border'
const SHEET = 'max-h-[92dvh] overflow-y-auto rounded-t-2xl'

type Translate = ReturnType<typeof useTranslations<'bookings.staff'>>

function ruleText(t: Translate, rule: BrokenRule): { title: string; detail: string | null } {
  if (rule.code === 'stopped') return { title: t(`rule.stopped_${rule.scope}`), detail: null }
  if (rule.code === 'slot_full' || rule.code === 'meal_full') {
    const title = rule.code === 'slot_full' ? t('rule.slot_full', { time: rule.time }) : t('rule.meal_full', { period: rule.period })
    return { title, detail: null }
  }
  return { title: t(`rule.${rule.code}`), detail: null }
}

export function RulesPrompt({ rules, party, saving, onBack, onOverride }: { rules: BrokenRule[]; party: number; saving: boolean; onBack: () => void; onOverride: () => void }) {
  const t = useTranslations('bookings.staff')
  return (
    <div data-testid="booking-rules-prompt" role="alertdialog" aria-labelledby="booking-rules-title" className="flex flex-col gap-4 px-4 pb-4">
      <h3 id="booking-rules-title" className="font-semibold text-foreground">{t('rulesTitle')}</h3>
      <ul className="flex flex-col gap-2">
        {rules.map((rule, i) => {
          const { title } = ruleText(t, rule)
          const full = rule.code === 'slot_full' || rule.code === 'meal_full'
          return (
            <li key={i} className="flex gap-3 rounded-lg border border-accent/40 bg-pending-soft p-3">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-pending-foreground" />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{title}</span>
                {full ? (
                  <span className="text-sm text-muted-foreground">
                    {t('rule.fullDetail', { guests: rule.guests, party, total: rule.guests + party, limit: rule.limit })}
                  </span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-sm text-muted-foreground">{t('rulesHint')}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" size="lg" onClick={onBack} disabled={saving}>{t('back')}</Button>
        <Button size="lg" onClick={onOverride} disabled={saving} autoFocus data-testid="booking-rules-override">{t('bookAnyway')}</Button>
      </div>
    </div>
  )
}

function StaleBanner({ kind, onReload }: { kind: 'changed' | 'open_change'; onReload: () => void }) {
  const t = useTranslations('bookings.staff')
  return (
    <div data-testid="booking-form-stale" role="alert" className="mx-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      <span className="flex-1">{t(kind === 'open_change' ? 'openChange' : 'stale')}</span>
      <Button variant="outline" size="sm" onClick={onReload}>{t('reload')}</Button>
    </div>
  )
}

export function StaffBookingFormDialog({ staff }: { staff: StaffBookingController }) {
  const t = useTranslations('bookings.staff')
  const tv = useTranslations('bookings')
  const isPhone = useIsPhone()
  const form = staff.form
  const booking = form?.booking ?? null
  const changed = form && booking ? changedFormFields(booking, form.values) : new Set<never>()
  return (
    <Sheet open={!!form} onOpenChange={(open) => !open && staff.closeForm()}>
      <SheetContent side="bottom" className={cn(isPhone ? SHEET : DIALOG, 'gap-0 p-0')} data-testid="booking-form">
        {form ? (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle className="text-lg font-semibold">{t(form.mode === 'new' ? 'formNewTitle' : 'formEditTitle')}</SheetTitle>
              <SheetDescription>
                {booking
                  ? t('formEditHint', { name: booking.name ?? booking.phone ?? '', status: tv(`status.${booking.status}`), source: tv(`views.source.${booking.source}`) })
                  : t('formNewHint')}
              </SheetDescription>
            </SheetHeader>
            {form.stale ? <StaleBanner kind={form.stale} onReload={() => void staff.reloadStale()} /> : null}
            {form.rules ? (
              <RulesPrompt rules={form.rules} party={form.values.partySize} saving={form.saving} onBack={staff.backFromRules} onOverride={() => void staff.submit(true)} />
            ) : (
              <form
                className="flex flex-col"
                onSubmit={(e) => {
                  e.preventDefault()
                  void staff.submit()
                }}
              >
                <div className="px-4 pb-2">
                  <StaffBookingFields
                    mode={form.mode} values={form.values} errors={form.errors} changed={changed} onChange={staff.setValues}
                    phoneOptional={!booking || booking.source === 'staff'}
                    own={booking ? { date: booking.bookingDate, time: booking.bookingTime, partySize: booking.partySize } : undefined}
                  />
                </div>
                <SheetFooter className="sticky bottom-0 flex-col-reverse gap-2 border-t border-border bg-popover sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" size="lg" onClick={staff.closeForm}>{t(form.stale ? 'close' : 'cancel')}</Button>
                  <Button type="submit" size="lg" disabled={form.saving || !!form.stale} data-testid="booking-form-save">
                    {form.saving ? t('saving') : t(form.mode === 'new' ? 'save' : 'saveEdit')}
                  </Button>
                </SheetFooter>
              </form>
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export function CancelBookingDialog({ staff }: { staff: StaffBookingController }) {
  const t = useTranslations('bookings.staff')
  const locale = useLocale()
  const isPhone = useIsPhone()
  const c = staff.cancel
  const when = c ? `${formatDate(c.booking.bookingDate, locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${c.booking.bookingTime}` : ''
  return (
    <Sheet open={!!c} onOpenChange={(open) => !open && staff.closeCancel()}>
      <SheetContent side="bottom" className={cn(isPhone ? SHEET : DIALOG, 'gap-0 p-0')} data-testid="booking-cancel-dialog">
        {c ? (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle className="text-lg font-semibold">{t('cancelTitle')}</SheetTitle>
              <SheetDescription>{t('cancelHint')}</SheetDescription>
            </SheetHeader>
            {c.stale ? (
              <p data-testid="booking-form-stale" role="alert" className="mx-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{t('cancelStale')}</p>
            ) : null}
            <dl className="mx-4 my-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-border p-3 text-sm">
              <dt className="text-muted-foreground">{t('diner')}</dt>
              <dd className="break-words text-foreground">{c.booking.name ?? ''} · <span className="tabular-nums">{c.booking.phone ?? t('noPhone')}</span></dd>
              <dt className="text-muted-foreground">{t('when')}</dt>
              <dd className="text-foreground">{when}</dd>
              <dt className="text-muted-foreground">{t('guests')}</dt>
              <dd className="tabular-nums text-foreground">{c.booking.partySize}</dd>
            </dl>
            <div className="flex flex-col gap-3 px-4">
              <NotifyCheck
                checked={c.notify && !!c.booking.phone} onChange={staff.setCancelNotify} label={t('notifyCancel')} disabled={!c.booking.phone}
                hint={c.booking.phone ? t('notifyCancelHint', { when }) : t('notifyNoPhone')} testId="booking-cancel-notify"
              />
              <CancelDepositChoices staff={staff} />
            </div>
            <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" size="lg" onClick={staff.closeCancel}>{t('keep')}</Button>
              <Button variant="destructive" size="lg" disabled={c.saving || c.stale} onClick={() => void staff.confirmCancel()} data-testid="booking-cancel-confirm">
                {t('confirmCancel')}
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

const CANCEL_DEPOSIT_CHOICES: readonly CancelDepositChoice[] = ['refund', 'keep', 'later']
const CHOICE_KEY = { refund: 'cancelRefund', keep: 'cancelKeep', later: 'cancelLater' } as const

/** BOOK-014 W4 (spec AC-13): a paid deposit's fate, decided with the cancel (or later on the row). */
function CancelDepositChoices({ staff }: { staff: StaffBookingController }) {
  const t = useTranslations('bookings.deposit')
  const c = staff.cancel
  const d = c?.booking.deposit
  if (!c || !d || d.status !== 'paid') return null
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="booking-cancel-deposit">
      <legend className="px-1 text-sm font-medium text-foreground">{t('cancelChoiceTitle', { amount: formatMoney(d.amount) })}</legend>
      {CANCEL_DEPOSIT_CHOICES.map((choice) => (
        <label key={choice} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-foreground">
          <input
            type="radio" name="booking-cancel-deposit" value={choice} checked={c.deposit === choice} onChange={() => staff.setCancelDeposit(choice)}
            data-testid={`booking-cancel-deposit-${choice}`} className="size-5 shrink-0 cursor-pointer accent-primary"
          />
          {t(CHOICE_KEY[choice])}
        </label>
      ))}
    </fieldset>
  )
}

/** Keys under `bookings` (BOOK-014 W4 adds the deposit toasts under `bookings.deposit`). */
const TOAST_KEY: Record<ToastKind, string> = {
  added: 'staff.toastAdded', updated: 'staff.toastUpdated', cancelled: 'staff.toastCancelled', throttled: 'staff.toastThrottled',
  not_delivered: 'staff.toastNotDelivered', failed: 'staff.saveFailed', off: 'staff.offRefused',
  deposit_sent: 'deposit.toastSent', deposit_not_sent: 'deposit.toastNotSent', payment_unavailable: 'deposit.toastUnavailable',
  link_copied: 'deposit.linkCopied', link_copy_failed: 'deposit.linkCopyFailed', refunded: 'deposit.refunded',
  refund_started: 'deposit.refundStarted', refund_failed: 'deposit.refundFailed', kept: 'deposit.kept',
  deposit_conflict: 'deposit.conflict', deposit_failed: 'deposit.actionFailed',
}

const WARN: ReadonlySet<ToastKind> = new Set<ToastKind>([
  'failed', 'not_delivered', 'off', 'throttled', 'deposit_not_sent', 'payment_unavailable', 'link_copy_failed', 'refund_failed',
  'deposit_conflict', 'deposit_failed',
])

export function BookingToast({ toast, onDismiss, onCopyLink }: { toast: Toast | null; onDismiss: () => void; onCopyLink?: (url: string) => void }) {
  const t = useTranslations('bookings')
  const tStaff = useTranslations('bookings.staff')
  const tDeposit = useTranslations('bookings.deposit')
  const locale = useLocale()
  if (!toast) return null
  const warn = WARN.has(toast.kind)
  const b = toast.booking
  const detail = b && !warn ? ` · ${formatDate(b.bookingDate, locale, { weekday: 'short', day: 'numeric', month: 'short' })}, ${b.bookingTime}, ${b.partySize}` : ''
  const Icon = warn ? AlertTriangle : CheckCircle2
  return (
    <div
      data-testid="booking-toast" data-kind={toast.kind} role="status" aria-live="polite"
      className={cn(
        'fixed inset-x-4 bottom-4 z-50 flex items-start gap-3 rounded-xl border bg-popover p-3 text-sm shadow-lg md:inset-x-auto md:right-6 md:bottom-6 md:max-w-md',
        warn ? 'border-destructive/40 text-destructive' : 'border-border text-foreground'
      )}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', !warn && 'text-primary')} />
      <span className="flex-1">{t(TOAST_KEY[toast.kind])}{detail}</span>
      {toast.paymentUrl && onCopyLink ? (
        <Button size="sm" variant="outline" className="-my-1 shrink-0" onClick={() => onCopyLink(toast.paymentUrl as string)} data-testid="booking-deposit-copy-link">
          <Copy aria-hidden />
          {tDeposit('copyLink')}
        </Button>
      ) : null}
      <button type="button" onClick={onDismiss} aria-label={tStaff('close')} className="-m-1 cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}
