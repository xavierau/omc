'use client'

/**
 * BOOK-008: the booking's diner name opens the member panel when the booking
 * is linked to a member (plain text when it is not), and the link control:
 * "Link member" on an unlinked booking, "Change member" / "Unlink member" on
 * a linked one. Change and Link open an inline search over the restaurant's
 * members (name or phone). Both need the Bookings screen's
 * BookingMemberContext; without it nothing here is interactive.
 * The link is for staff only (R3): it changes nothing the diner receives.
 * BOOK-013 AC-26: a booking without a phone offers no Link / Change member
 * (the API refuses it, phone_required); Unlink stays should it hold a link.
 */
import { useContext, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { BookingItem } from '@/hooks/use-bookings'
import { hasPhone } from '@/domain/entities/booking-request'
import { BookingMemberContext, useMemberSearch, type MemberOption, type MemberSearchState } from './use-booking-member'

export function BookingGuestName({ booking, className }: { booking: BookingItem; className?: string }) {
  const t = useTranslations('bookings')
  const actions = useContext(BookingMemberContext)
  const name = booking.name ?? t('nameRemoved')
  const memberId = booking.memberId
  if (!actions || !memberId) return <span className={className}>{name}</span>
  return (
    <button
      type="button"
      title={t('viewMember')}
      onClick={() => actions.openMember(memberId)}
      data-testid={`booking-row-${booking.id}-member`}
      className={cn(
        className,
        'cursor-pointer text-left underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-current',
        'rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      )}
    >
      {name}
    </button>
  )
}

function Option({ bookingId, member, current, onPick }: { bookingId: string; member: MemberOption; current: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        disabled={current}
        onClick={onPick}
        data-testid={`booking-row-${bookingId}-member-option-${member.id}`}
        className="flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-muted disabled:cursor-default disabled:opacity-50"
      >
        <span className="min-w-0 truncate font-medium text-foreground">{member.name ?? member.phone}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{member.phone}</span>
      </button>
    </li>
  )
}

export function SearchResults(props: { bookingId: string; state: MemberSearchState; currentId: string | null; onPick: (id: string) => void }) {
  const { bookingId, state, currentId, onPick } = props
  const t = useTranslations('bookings')
  const line = (key: string, testId: string, tone = 'text-muted-foreground') => (
    <p role="status" className={cn('px-2 text-sm', tone)} data-testid={`booking-row-${bookingId}-member-search-${testId}`}>{t(key)}</p>
  )
  if (state.kind === 'idle') return null
  if (state.kind === 'loading') return line('memberSearching', 'loading')
  if (state.kind === 'failed') return line('memberSearchFailed', 'error', 'text-destructive')
  if (state.members.length === 0) return line('memberSearchEmpty', 'empty')
  return (
    <ul className="flex flex-col">
      {state.members.map((m) => (
        <Option key={m.id} bookingId={bookingId} member={m} current={m.id === currentId} onPick={() => onPick(m.id)} />
      ))}
    </ul>
  )
}

function MemberPicker({ booking, onPick, onCancel }: { booking: BookingItem; onPick: (id: string) => void; onCancel: () => void }) {
  const t = useTranslations('bookings')
  const [query, setQuery] = useState('')
  const state = useMemberSearch(query)
  return (
    <div className="flex w-full min-w-56 flex-col gap-1.5" data-testid={`booking-row-${booking.id}-member-picker`}>
      <div className="flex gap-2">
        <Input
          autoFocus
          value={query}
          aria-label={t('memberSearchLabel')}
          placeholder={t('memberSearchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
          data-testid={`booking-row-${booking.id}-member-search`}
          className="h-9 min-w-0 flex-1"
        />
        <Button size="sm" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
      </div>
      <SearchResults bookingId={booking.id} state={state} currentId={booking.memberId} onPick={onPick} />
    </div>
  )
}

export function MemberLinkControl({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings')
  const actions = useContext(BookingMemberContext)
  const [picking, setPicking] = useState(false)
  if (!actions) return null
  const busy = actions.busyIds.has(booking.id)
  if (picking) {
    const pick = (memberId: string) => {
      setPicking(false)
      void actions.link(booking.id, memberId)
    }
    return <MemberPicker booking={booking} onPick={pick} onCancel={() => setPicking(false)} />
  }
  const linked = booking.memberId !== null
  const linkable = hasPhone(booking)
  if (!linked && !linkable) return null
  return (
    <div className="-ml-2 flex flex-wrap gap-1 [&>button]:cursor-pointer [&>button]:text-muted-foreground [&>button:hover]:text-foreground">
      {linkable ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicking(true)} data-testid={`booking-row-${booking.id}-member-link`}>
          {t(linked ? 'changeMember' : 'linkMember')}
        </Button>
      ) : null}
      {linked ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void actions.link(booking.id, null)} data-testid={`booking-row-${booking.id}-member-unlink`}>
          {t('unlinkMember')}
        </Button>
      ) : null}
    </div>
  )
}

/** BOOK-008: the notice when a link, relink or unlink did not go through (the list was reloaded). */
export function MemberLinkNoticeLine({ failed }: { failed: boolean }) {
  const t = useTranslations('bookings')
  if (!failed) return null
  return (
    <p role="status" className="text-sm text-destructive" data-testid="booking-member-link-notice">{t('memberLinkFailed')}</p>
  )
}
