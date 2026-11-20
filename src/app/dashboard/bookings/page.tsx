'use client'

/**
 * BOOK-001 AC-13/AC-14: staff handle booking requests (sidebar → Bookings).
 * BOOK-004: Calendar (default) and Table views; `?view=` needs a Suspense
 * boundary for useSearchParams.
 */
import { Suspense } from 'react'
import { BookingsLoading, BookingsScreen } from '@/components/dashboard/bookings/bookings-screen'

export default function BookingsPage() {
  return (
    <Suspense fallback={<BookingsLoading />}>
      <BookingsScreen />
    </Suspense>
  )
}
